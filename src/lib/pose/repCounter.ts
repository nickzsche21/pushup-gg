import { AngleFilter, L, Pt, angleDeg, midpoint, visible } from "./geometry";

export type NoRepReason = "shallow" | "hips" | "fast" | "lost";

export interface RepEvent {
  index: number;
  tMs: number;
  depthDeg: number;
  durationMs: number;
}

export interface NoRepEvent {
  tMs: number;
  reason: NoRepReason;
  depthDeg: number;
}

export interface Frame {
  /** Median-filtered elbow angle, degrees. 180 = locked out. What judges reps. */
  elbow: number;
  /** Smoothed elbow angle. Nicer to animate, too laggy to judge with. */
  elbowSmooth: number;
  /** Shoulder–hip–ankle angle, degrees. 180 = a perfect plank. */
  bodyLine: number;
  /** How far through the current rep, 0 (top) → 1 (at depth). */
  depthPct: number;
  tracked: boolean;
  inPosition: boolean;
  phase: Phase;
}

type Phase = "top" | "descending" | "ascending";

export interface CounterConfig {
  /** Elbow angle above which the arms count as locked out. */
  topAngle: number;
  /** Elbow angle you must break to be credited with depth. */
  bottomAngle: number;
  /** Breaking this on the way down opens a rep attempt. */
  descendMark: number;
  /** Reps faster than this are bounces, not reps. */
  minRepMs: number;
  /** Minimum shoulder–hip–ankle angle held through the rep. */
  bodyLineMin: number;
  minVisibility: number;
}

export const STRICTNESS = {
  casual: { topAngle: 150, bottomAngle: 105, descendMark: 135, minRepMs: 300, bodyLineMin: 140, minVisibility: 0.4 },
  ranked: { topAngle: 155, bottomAngle: 95, descendMark: 140, minRepMs: 380, bodyLineMin: 152, minVisibility: 0.5 },
  strict: { topAngle: 162, bottomAngle: 85, descendMark: 145, minRepMs: 450, bodyLineMin: 160, minVisibility: 0.6 },
} satisfies Record<string, CounterConfig>;

export type Strictness = keyof typeof STRICTNESS;

/**
 * Turns a stream of pose landmarks into a rep count.
 *
 * A rep is a full round trip: locked out at the top, elbows broken past the
 * depth threshold, back to lockout — with the body line held throughout and
 * taking longer than a bounce. Anything that completes the round trip but
 * fails a gate is emitted as a no-rep with the reason, because "that one
 * didn't count, and here's why" is the whole point of a referee.
 */
export class RepCounter {
  private cfg: CounterConfig;
  private elbowFilter = new AngleFilter(0.45);
  private bodyFilter = new AngleFilter(0.3);

  private phase: Phase = "top";
  private repStartMs = 0;
  // Two lowest *raw* elbow readings this rep. Depth is credited from the
  // second lowest, so a single bad frame can't manufacture a rep, and a real
  // turnaround isn't clipped by the filter the way a windowed minimum is.
  private low1 = 180;
  private low2 = 180;
  private worstBodyLineThisRep = 180;
  private lostSinceMs: number | null = null;
  private inPositionSinceMs: number | null = null;

  reps: RepEvent[] = [];
  noReps: NoRepEvent[] = [];

  constructor(
    strictness: Strictness = "ranked",
    private onRep?: (r: RepEvent) => void,
    private onNoRep?: (n: NoRepEvent) => void,
  ) {
    this.cfg = { ...STRICTNESS[strictness] };
  }

  get count() {
    return this.reps.length;
  }

  reset() {
    this.reps = [];
    this.noReps = [];
    this.phase = "top";
    this.low1 = 180;
    this.low2 = 180;
    this.worstBodyLineThisRep = 180;
    this.lostSinceMs = null;
    this.inPositionSinceMs = null;
    this.elbowFilter.reset();
    this.bodyFilter.reset();
  }

  /**
   * @param world  MediaPipe world landmarks (metres) — used for every angle.
   * @param image  Normalised image landmarks — used only to tell a push-up
   *               position apart from someone standing in front of the camera.
   */
  update(world: Pt[] | null, image: Pt[] | null, tMs: number): Frame {
    const v = this.cfg.minVisibility;

    if (!world || world.length < 29) return this.lost(tMs);

    // Prefer whichever side the camera can actually see. Filming a push-up is
    // a side-on affair, so one arm is routinely occluded by the torso.
    const sides: Array<[number, number, number]> = [
      [L.L_SHOULDER, L.L_ELBOW, L.L_WRIST],
      [L.R_SHOULDER, L.R_ELBOW, L.R_WRIST],
    ];
    const elbowAngles: number[] = [];
    for (const [s, e, w] of sides) {
      if (visible(world[s], v) && visible(world[e], v) && visible(world[w], v)) {
        elbowAngles.push(angleDeg(world[s], world[e], world[w]));
      }
    }
    if (elbowAngles.length === 0) return this.lost(tMs);

    // Ankles disappear from frame constantly (people crop their feet out), so
    // fall back to the knee before giving up on the body-line check entirely.
    const shoulder = this.pair(world, L.L_SHOULDER, L.R_SHOULDER, v);
    const hip = this.pair(world, L.L_HIP, L.R_HIP, v);
    const ankle = this.pair(world, L.L_ANKLE, L.R_ANKLE, v) ?? this.pair(world, L.L_KNEE, L.R_KNEE, v);
    if (!shoulder || !hip) return this.lost(tMs);

    const rawElbow = Math.min(...elbowAngles);
    const elbowF = this.elbowFilter.push(rawElbow);
    const elbow = elbowF.value;
    const bodyLine = ankle ? this.bodyFilter.push(angleDeg(shoulder, hip, ankle)).value : 180;

    this.lostSinceMs = null;

    // Horizontal torso ⇒ actually on the floor, rather than standing and
    // waving their arms at the depth threshold.
    let inPosition = false;
    if (image && image.length > L.R_HIP) {
      const iShoulder = this.pair(image, L.L_SHOULDER, L.R_SHOULDER, 0.3);
      const iHip = this.pair(image, L.L_HIP, L.R_HIP, 0.3);
      if (iShoulder && iHip) {
        const horizontal = Math.abs(iShoulder.x - iHip.x) > Math.abs(iShoulder.y - iHip.y) * 0.8;
        inPosition = horizontal && bodyLine >= this.cfg.bodyLineMin - 10;
      }
    }
    if (inPosition) this.inPositionSinceMs ??= tMs;
    else this.inPositionSinceMs = null;

    this.step(elbow, rawElbow, bodyLine, tMs);

    const span = this.cfg.descendMark - this.cfg.bottomAngle;
    const depthPct = Math.min(1, Math.max(0, (this.cfg.descendMark - elbow) / span));

    return {
      elbow,
      elbowSmooth: elbowF.smooth,
      bodyLine,
      depthPct,
      tracked: true,
      inPosition,
      phase: this.phase,
    };
  }

  /** True once the athlete has held a plank for `ms` — used to auto-start. */
  readyFor(ms: number, tMs: number) {
    return this.inPositionSinceMs !== null && tMs - this.inPositionSinceMs >= ms;
  }

  private step(elbow: number, rawElbow: number, bodyLine: number, tMs: number) {
    const c = this.cfg;

    if (this.phase !== "top") {
      if (rawElbow < this.low1) {
        this.low2 = this.low1;
        this.low1 = rawElbow;
      } else if (rawElbow < this.low2) {
        this.low2 = rawElbow;
      }
      this.worstBodyLineThisRep = Math.min(this.worstBodyLineThisRep, bodyLine);
    }

    switch (this.phase) {
      case "top":
        if (elbow < c.descendMark) {
          this.phase = "descending";
          this.repStartMs = tMs;
          this.low1 = rawElbow;
          this.low2 = rawElbow;
          this.worstBodyLineThisRep = bodyLine;
        }
        break;

      case "descending":
        if (elbow <= c.bottomAngle) {
          this.phase = "ascending";
        } else if (elbow > c.topAngle) {
          // Came back up without ever reaching depth.
          this.emitNoRep(tMs, "shallow");
          this.phase = "top";
        }
        break;

      case "ascending":
        if (elbow > c.topAngle) {
          const durationMs = tMs - this.repStartMs;
          if (durationMs < c.minRepMs) this.emitNoRep(tMs, "fast");
          else if (this.worstBodyLineThisRep < c.bodyLineMin) this.emitNoRep(tMs, "hips");
          else {
            const rep: RepEvent = {
              index: this.reps.length + 1,
              tMs,
              depthDeg: Math.round(this.low2),
              durationMs: Math.round(durationMs),
            };
            this.reps.push(rep);
            this.onRep?.(rep);
          }
          this.phase = "top";
        }
        break;
    }
  }

  private emitNoRep(tMs: number, reason: NoRepReason) {
    const n: NoRepEvent = { tMs, reason, depthDeg: Math.round(this.low2) };
    this.noReps.push(n);
    this.onNoRep?.(n);
  }

  private pair(pts: Pt[], a: number, b: number, v: number): Pt | null {
    const ok: Pt[] = [];
    if (visible(pts[a], v)) ok.push(pts[a]);
    if (visible(pts[b], v)) ok.push(pts[b]);
    if (ok.length === 0) return null;
    return ok.length === 2 ? midpoint(ok[0], ok[1]) : ok[0];
  }

  private lost(tMs: number): Frame {
    this.lostSinceMs ??= tMs;
    this.inPositionSinceMs = null;

    // Half a second of no tracking voids any rep in progress — otherwise you
    // could drop out of frame at the bottom and reappear locked out at the top.
    // The filters are dropped either way: angles from before the gap are stale,
    // and blending them into the frames after it produces phantom transitions.
    if (tMs - this.lostSinceMs > 500) {
      if (this.phase !== "top") {
        this.emitNoRep(tMs, "lost");
        this.phase = "top";
      }
      this.elbowFilter.reset();
      this.bodyFilter.reset();
    }
    return {
      elbow: 180,
      elbowSmooth: 180,
      bodyLine: 180,
      depthPct: 0,
      tracked: false,
      inPosition: false,
      phase: this.phase,
    };
  }
}

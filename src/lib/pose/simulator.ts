import type { Pt } from "./geometry";

const D = Math.PI / 180;

/**
 * Builds a world-landmark skeleton posed at the given elbow and body angles.
 *
 * Shared by the test suite and by demo mode, so what the tests exercise and
 * what the demo shows are driven through exactly the same geometry the real
 * camera path produces.
 */
export function syntheticSkeleton(elbowDeg: number, bodyDeg: number, flareDeg = 45): Pt[] {
  const pts: Pt[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));

  // Shoulder at the origin, hip along +x, so the torso direction is (1,0,0).
  const S = { x: 0, y: 0, z: 0, visibility: 1 };
  const H = { x: 0.5, y: 0, z: 0, visibility: 1 };

  // Place the elbow so the shoulder angle between upper arm and torso is
  // exactly flareDeg, then the wrist so the elbow angle is exactly elbowDeg.
  const f = flareDeg * D;
  const E = { x: 0.3 * Math.cos(f), y: -0.3 * Math.sin(f), z: 0, visibility: 1 };

  const ux = -Math.cos(f);
  const uy = Math.sin(f);
  const e = elbowDeg * D;
  const W = {
    x: E.x + 0.3 * (ux * Math.cos(e) - uy * Math.sin(e)),
    y: E.y + 0.3 * (ux * Math.sin(e) + uy * Math.cos(e)),
    z: 0,
    visibility: 1,
  };

  const A = { x: H.x - 0.6 * Math.cos(bodyDeg * D), y: H.y + 0.6 * Math.sin(bodyDeg * D), z: 0, visibility: 1 };
  const K = { x: (H.x + A.x) / 2, y: (H.y + A.y) / 2, z: 0, visibility: 1 };

  for (const [l, r, v] of [[11, 12, S], [13, 14, E], [15, 16, W], [23, 24, H], [25, 26, K], [27, 28, A]] as const) {
    pts[l] = { ...v };
    pts[r] = { ...v };
  }
  return pts;
}

/** Image-space landmarks for a side-on push-up, drawn as a rough stick figure. */
export function syntheticImage(elbowDeg: number, bodyDeg: number): Pt[] {
  const pts: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const depth = (176 - elbowDeg) / 100; // 0 at the top, ~1 at the bottom
  const sag = (180 - bodyDeg) / 100;

  const shoulderY = 0.42 + depth * 0.16;
  const hipY = 0.44 + depth * 0.1 + sag * 0.18;

  const set = (i: number, x: number, y: number) => (pts[i] = { x, y, visibility: 1 });
  set(11, 0.36, shoulderY);
  set(12, 0.36, shoulderY + 0.02);
  set(13, 0.3, shoulderY + 0.11);
  set(14, 0.3, shoulderY + 0.13);
  set(15, 0.28, 0.72);
  set(16, 0.28, 0.74);
  set(23, 0.58, hipY);
  set(24, 0.58, hipY + 0.02);
  set(25, 0.72, hipY + 0.08);
  set(26, 0.72, hipY + 0.1);
  set(27, 0.85, 0.74);
  set(28, 0.85, 0.76);
  return pts;
}

export interface AthleteOptions {
  /** Seconds per rep at the start of the set. */
  basePeriodMs?: number;
  /** Share of reps that fail a form gate on purpose. */
  sloppiness?: number;
}

/**
 * A stand-in athlete for demo mode and for driving the UI without a camera.
 *
 * It deliberately throws the occasional shallow rep, dropped hip and bounce,
 * because a referee that never says NO REP looks broken rather than lenient.
 */
export class SimulatedAthlete {
  private cycleStart = 0;
  private period: number;
  private bottom = 78;
  private body = 176;
  private flare = 45;
  private reps = 0;
  private readonly base: number;
  private readonly sloppiness: number;

  constructor(opts: AthleteOptions = {}) {
    this.base = opts.basePeriodMs ?? 1500;
    this.sloppiness = opts.sloppiness ?? 0.22;
    this.period = this.base;
  }

  sample(tMs: number): { world: Pt[]; image: Pt[] } {
    if (this.cycleStart === 0) this.cycleStart = tMs;
    if (tMs - this.cycleStart > this.period) this.nextCycle(tMs);

    const k = tMs - this.cycleStart;
    const half = this.period / 2;
    const tri = k <= half ? k / half : (this.period - k) / half;
    const elbow = 176 - (176 - this.bottom) * tri;

    return {
      world: syntheticSkeleton(elbow, this.body, this.flare),
      image: syntheticImage(elbow, this.body),
    };
  }

  private nextCycle(tMs: number) {
    this.cycleStart = tMs;
    this.reps += 1;

    const fatigue = 1 + Math.min(1.1, this.reps / 26);
    const roll = Math.random();

    if (roll < this.sloppiness * 0.5) {
      this.bottom = 112; // stopped short
      this.body = 176;
      this.period = this.base * fatigue;
    } else if (roll < this.sloppiness * 0.8) {
      this.bottom = 74;
      this.body = 132; // hips dropped
      this.period = this.base * fatigue;
    } else if (roll < this.sloppiness) {
      this.bottom = 62;
      this.body = 176;
      this.period = 330; // bounced
    } else {
      this.bottom = 72 + Math.random() * 14;
      this.body = 168 + Math.random() * 10;
      this.flare = 40 + Math.random() * 30;
      this.period = this.base * fatigue * (0.9 + Math.random() * 0.2);
    }
  }
}

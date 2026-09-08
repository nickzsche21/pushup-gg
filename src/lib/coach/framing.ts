import { L, type Pt, visible } from "../pose/geometry";

export type FramingIssue =
  | "ok"
  | "no-one"
  | "face-on"
  | "too-far"
  | "too-close"
  | "tail-cropped"
  | "arms-cropped";

export interface Framing {
  issue: FramingIssue;
  /** What to actually do about it. */
  hint: string;
  /** Spoken form — shorter, because it is said out loud. */
  spoken: string;
}

const RESULTS: Record<FramingIssue, Omit<Framing, "issue">> = {
  ok: { hint: "Framing looks good", spoken: "" },
  "no-one": {
    hint: "Can't see anyone. Put the phone or laptop on the floor, screen facing you, a step to your side.",
    spoken: "I can't see you",
  },
  "face-on": {
    hint: "Move the camera to your side. Head-on it can't see your elbows bend, which is the whole measurement.",
    spoken: "Put the camera at your side",
  },
  "too-far": {
    hint: "You're small in frame — move the camera closer, or bring it nearer the floor.",
    spoken: "Camera closer",
  },
  "too-close": {
    hint: "Too close to fit you in. Slide the camera back a step.",
    spoken: "Camera back",
  },
  "tail-cropped": {
    hint: "Your legs are out of shot. The body-line check needs hip to ankle, so move the camera back.",
    spoken: "Your legs are out of shot",
  },
  "arms-cropped": {
    hint: "Your shoulders or hands are out of shot. Slide the camera back until your whole side is in frame.",
    spoken: "Move the camera back",
  },
};

function mid(pts: Pt[], a: number, b: number, v: number): Pt | null {
  const l = visible(pts[a], v) ? pts[a] : null;
  const r = visible(pts[b], v) ? pts[b] : null;
  if (!l && !r) return null;
  if (l && r) return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 };
  return (l ?? r)!;
}

/**
 * Says what is wrong with the camera setup, in the order worth fixing.
 *
 * This exists because "get into position" is useless advice when the real
 * problem is that the laptop is on a desk and the athlete's legs are a metre
 * outside the shot — the single most common complaint about every webcam rep
 * counter is that people cannot work out where to put the camera.
 */
export function analyseFraming(image: Pt[] | null, tailJoint: "ankle" | "knee" = "ankle"): Framing {
  const out = (issue: FramingIssue): Framing => ({ issue, ...RESULTS[issue] });
  if (!image || image.length < 29) return out("no-one");

  const V = 0.4;
  const shoulder = mid(image, L.L_SHOULDER, L.R_SHOULDER, V);
  const hip = mid(image, L.L_HIP, L.R_HIP, V);
  if (!shoulder || !hip) return out("no-one");

  const wrist = mid(image, L.L_WRIST, L.R_WRIST, V);
  const knee = mid(image, L.L_KNEE, L.R_KNEE, V);
  const ankle = mid(image, L.L_ANKLE, L.R_ANKLE, V);
  const tail = tailJoint === "knee" ? knee : (ankle ?? knee);

  // A push-up body lies across the frame. If the torso reads as more vertical
  // than horizontal, the camera is in front of them rather than beside them.
  const dx = Math.abs(shoulder.x - hip.x);
  const dy = Math.abs(shoulder.y - hip.y);
  if (dx < dy * 0.8) return out("face-on");

  if (!tail) return out("tail-cropped");
  if (!wrist) return out("arms-cropped");

  const xs = [shoulder.x, hip.x, tail.x, wrist.x];
  const ys = [shoulder.y, hip.y, tail.y, wrist.y];
  const spanX = Math.max(...xs) - Math.min(...xs);

  // Landmarks pinned to an edge mean the body continues past it.
  const clipped =
    Math.min(...xs) < 0.02 || Math.max(...xs) > 0.98 || Math.min(...ys) < 0.02 || Math.max(...ys) > 0.98;
  if (clipped && spanX > 0.85) return out("too-close");
  if (spanX < 0.34) return out("too-far");

  return out("ok");
}

/**
 * Holds a framing verdict steady before acting on it.
 *
 * Raw per-frame analysis flickers as landmarks come and go, and an overlay
 * that rewrites its advice thirty times a second is unreadable.
 */
export class FramingStabiliser {
  private candidate: FramingIssue = "no-one";
  private since = 0;
  private settled: Framing = { issue: "no-one", ...RESULTS["no-one"] };

  constructor(private holdMs = 700) {}

  push(f: Framing, tMs: number): Framing {
    if (f.issue !== this.candidate) {
      this.candidate = f.issue;
      this.since = tMs;
    } else if (tMs - this.since >= this.holdMs && this.settled.issue !== f.issue) {
      this.settled = f;
    }
    return this.settled;
  }

  get current() {
    return this.settled;
  }
}

/** BlazePose (MediaPipe Pose) landmark indices we care about. */
export const L = {
  NOSE: 0,
  L_SHOULDER: 11,
  R_SHOULDER: 12,
  L_ELBOW: 13,
  R_ELBOW: 14,
  L_WRIST: 15,
  R_WRIST: 16,
  L_HIP: 23,
  R_HIP: 24,
  L_KNEE: 25,
  R_KNEE: 26,
  L_ANKLE: 27,
  R_ANKLE: 28,
} as const;

export interface Pt {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/**
 * Interior angle at `b`, in degrees, using 3D coordinates when present.
 * We feed this MediaPipe *world* landmarks (metres, hip-centred) rather than
 * the normalised image landmarks, so the answer doesn't skew with the camera's
 * aspect ratio or the athlete's distance from the lens.
 */
export function angleDeg(a: Pt, b: Pt, c: Pt): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const abz = (a.z ?? 0) - (b.z ?? 0);
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const cbz = (c.z ?? 0) - (b.z ?? 0);

  const dot = abx * cbx + aby * cby + abz * cbz;
  const magA = Math.hypot(abx, aby, abz);
  const magC = Math.hypot(cbx, cby, cbz);
  if (magA === 0 || magC === 0) return 180;

  const cos = Math.min(1, Math.max(-1, dot / (magA * magC)));
  return (Math.acos(cos) * 180) / Math.PI;
}

export function midpoint(a: Pt, b: Pt): Pt {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

export function visible(p: Pt | undefined, min: number): p is Pt {
  return !!p && (p.visibility ?? 1) >= min;
}

/**
 * Median-of-3, plus an exponential moving average alongside it.
 *
 * The median is what the referee reads: it annihilates single-frame landmark
 * pops (a hand briefly tracked onto its own shadow, which could otherwise fake
 * depth) while costing only one frame of lag and barely clipping the bottom of
 * a rep. The EMA is deliberately *not* used for judging — it lags the turnaround
 * badly enough to steal several degrees of depth — and only feeds the on-screen
 * gauge, where smoothness is worth more than precision.
 */
export class AngleFilter {
  private ring: number[] = [];
  private ema: number | null = null;

  constructor(private alpha = 0.5) {}

  push(v: number): { value: number; smooth: number } {
    this.ring.push(v);
    if (this.ring.length > 3) this.ring.shift();

    const sorted = [...this.ring].sort((a, b) => a - b);
    const value =
      sorted.length === 2 ? (sorted[0] + sorted[1]) / 2 : sorted[(sorted.length - 1) >> 1];

    this.ema = this.ema === null ? value : this.alpha * value + (1 - this.alpha) * this.ema;
    return { value, smooth: this.ema };
  }

  reset() {
    this.ring = [];
    this.ema = null;
  }
}

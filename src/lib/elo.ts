import { PLACEMENT_MATCHES } from "./ranks";

export const START_RATING = 1000;

export interface EloInput {
  rating: number;
  /** Matches played before this one — drives the placement K-factor. */
  matches: number;
}

export interface EloResult {
  aDelta: number;
  bDelta: number;
}

function kFactor(m: number, ghost: boolean) {
  // Placements move fast so a new player lands near their real level within a
  // handful of matches; ghosts move you at half speed because the opponent is
  // a recording and can't be surprised by you.
  const base = m < PLACEMENT_MATCHES ? 64 : m < 20 ? 40 : 28;
  return ghost ? base / 2 : base;
}

/**
 * Elo, but the margin matters.
 *
 * Straight win/loss throws away most of what a push-up match tells you: 21–20
 * and 21–3 are not the same result. The actual score is nudged toward the rep
 * ratio, so a blowout moves the ladder further than a photo finish.
 */
export function computeElo(
  a: EloInput,
  b: EloInput,
  aReps: number,
  bReps: number,
  opts: { ghost?: boolean } = {},
): EloResult {
  const expectedA = 1 / (1 + 10 ** ((b.rating - a.rating) / 400));

  const total = aReps + bReps;
  const share = total === 0 ? 0.5 : aReps / total;
  const outcome = aReps === bReps ? 0.5 : aReps > bReps ? 1 : 0;

  // 70% who won, 30% by how much.
  const actualA = 0.7 * outcome + 0.3 * share;

  const kA = kFactor(a.matches, !!opts.ghost);
  const kB = kFactor(b.matches, !!opts.ghost);

  const aDelta = Math.round(kA * (actualA - expectedA));
  const bDelta = Math.round(kB * (1 - actualA - (1 - expectedA)));

  return { aDelta, bDelta };
}

/**
 * Rejects rep timelines a human body could not have produced.
 *
 * This is not real anti-cheat — the camera runs on the player's machine and a
 * determined person can lie to any client. It is a plausibility floor that
 * stops the obvious "POST myself 500 reps" attack from reaching the ladder.
 */
export function implausible(timeline: number[], durationS: number, reps: number): string | null {
  if (reps !== timeline.length) return "count-mismatch";
  if (reps === 0) return null;

  const sorted = [...timeline].sort((x, y) => x - y);
  if (sorted[0] < 0 || sorted[sorted.length - 1] > durationS * 1000 + 2000) return "out-of-window";

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] < 250) return "impossible-cadence";
  }

  // The world record for a minute sits near 1.7 reps/s. Anything sustained
  // above 2.5/s over a real interval is not a push-up.
  if (durationS >= 10 && reps / durationS > 2.5) return "impossible-rate";

  return null;
}

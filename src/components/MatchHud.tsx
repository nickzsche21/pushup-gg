"use client";

import { RankBadge } from "./RankBadge";
import type { NoRepReason } from "@/lib/pose/repCounter";

export interface Side {
  handle: string;
  rating: number;
  reps: number;
  isGhost?: boolean;
}

const REASON_TEXT: Record<NoRepReason, string> = {
  shallow: "NO REP · GO LOWER",
  hips: "NO REP · HIPS DROPPED",
  fast: "NO REP · TOO FAST",
  lost: "NO REP · LOST YOU",
};

export default function MatchHud({
  me,
  opp,
  clock,
  noRep,
  subtitle,
}: {
  me: Side;
  opp: Side | null;
  clock: string;
  noRep: { reason: NoRepReason; key: number } | null;
  subtitle?: string;
}) {
  const total = me.reps + (opp?.reps ?? 0);
  const share = total === 0 ? 0.5 : me.reps / total;

  return (
    <>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
        <div className="hud mx-auto max-w-2xl rounded-2xl px-4 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="display truncate text-base leading-tight">{me.handle}</p>
              <div className="mt-1">
                <RankBadge rating={me.rating} size="sm" />
              </div>
            </div>

            <div className="shrink-0 text-center">
              <p className="display text-[10px] tracking-[0.2em] text-muted">
                {subtitle ?? (opp?.isGhost ? "GHOST MATCH" : "RANKED MATCH")}
              </p>
              <p className="display tabular text-3xl leading-none">{clock}</p>
            </div>

            <div className="min-w-0 flex-1 text-right">
              <p className="display truncate text-base leading-tight">
                {opp ? opp.handle : "—"}
                {opp?.isGhost && <span className="ml-1 align-middle text-[10px] text-muted">GHOST</span>}
              </p>
              <div className="mt-1 flex justify-end">
                {opp ? <RankBadge rating={opp.rating} size="sm" /> : null}
              </div>
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <span className="display tabular w-9 text-2xl leading-none text-you">{me.reps}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-them">
              <div
                className="absolute inset-y-0 left-0 bg-you transition-[width] duration-300 ease-out"
                style={{ width: `${share * 100}%` }}
              />
              <div className="absolute inset-y-0 left-1/2 w-px bg-white/35" />
            </div>
            <span className="display tabular w-9 text-right text-2xl leading-none text-them">
              {opp?.reps ?? 0}
            </span>
          </div>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center pb-8">
        {noRep && (
          <p key={noRep.key} className="display shake mb-3 rounded-lg bg-them px-4 py-1.5 text-lg text-white">
            {REASON_TEXT[noRep.reason]}
          </p>
        )}
        <p
          key={me.reps}
          className="display pop text-[7rem] leading-[0.8] text-white"
          style={{ textShadow: "0 6px 40px rgba(0,0,0,0.85)" }}
        >
          {me.reps}
        </p>
      </div>
    </>
  );
}

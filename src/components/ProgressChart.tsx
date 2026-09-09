"use client";

import { dailySeries, lifetimeReps, type TrainingState } from "@/lib/training";

/**
 * Volume per day, with best-set laid over it.
 *
 * Two different questions get confused constantly: "am I doing more work" and
 * "am I getting stronger". Volume answers the first and can be moved by simply
 * showing up more often; the best single set answers the second and is the one
 * that stalls. Plotting them together is what makes a plateau visible.
 */
export default function ProgressChart({ state, days = 30 }: { state: TrainingState; days?: number }) {
  const series = dailySeries(state, days);
  const maxReps = Math.max(10, ...series.map((d) => d.reps));
  const maxBest = Math.max(5, ...series.map((d) => d.best));
  const active = series.filter((d) => d.reps > 0).length;

  if (active === 0) {
    return (
      <p className="text-sm text-muted">
        Nothing logged yet. Sets show up here the moment you finish one — volume as bars, your
        biggest single set as the line over the top.
      </p>
    );
  }

  const W = 100;
  const H = 46;
  const colW = W / series.length;

  const bestPoints = series
    .map((d, i) => (d.best > 0 ? `${i * colW + colW / 2},${H - (d.best / maxBest) * H * 0.92}` : null))
    .filter(Boolean) as string[];

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-lg">Last {days} days</h3>
        <span className="tabular text-xs text-muted">
          {active} active {active === 1 ? "day" : "days"} · {lifetimeReps(state)} reps all time
        </span>
      </div>

      <div className="panel mt-3 p-3">
        <div className="relative h-32 w-full">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-full w-full overflow-visible">
            {series.map((d, i) => (
              <rect
                key={d.date}
                x={i * colW + colW * 0.18}
                y={H - (d.reps / maxReps) * H}
                width={colW * 0.64}
                height={Math.max(d.reps > 0 ? 0.7 : 0, (d.reps / maxReps) * H)}
                rx={colW * 0.18}
                fill={d.reps > 0 ? "#24e07f" : "transparent"}
                opacity={0.55}
              />
            ))}
            {bestPoints.length > 1 && (
              <polyline
                points={bestPoints.join(" ")}
                fill="none"
                stroke="#f0b429"
                strokeWidth="1.6"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {series.map((d, i) =>
              d.best > 0 ? (
                <circle
                  key={`p${d.date}`}
                  cx={i * colW + colW / 2}
                  cy={H - (d.best / maxBest) * H * 0.92}
                  r="0.9"
                  fill="#f0b429"
                />
              ) : null,
            )}
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted">
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-2 w-2 rounded-sm opacity-60" style={{ background: "#24e07f" }} />
            daily volume — peak {maxReps}
          </span>
          <span className="flex items-center gap-1.5">
            <i className="inline-block h-0.5 w-3" style={{ background: "#f0b429" }} />
            best single set — peak {maxBest}
          </span>
        </div>
      </div>
    </div>
  );
}

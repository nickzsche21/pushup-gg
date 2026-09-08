"use client";

import type { CounterConfig, NoRepEvent, RepEvent } from "@/lib/pose/repCounter";

/**
 * What the referee saw, rep by rep.
 *
 * The reason this exists rather than a single rep total: the most-asked
 * push-up question anywhere is some version of "why am I not getting better",
 * and the answer is usually visible here — depth creeping up as the set goes
 * on, or a lowering phase so fast there is no tension in it at all.
 */
export default function FormReport({
  reps,
  noReps,
  config,
}: {
  reps: RepEvent[];
  noReps: NoRepEvent[];
  config: CounterConfig;
}) {
  if (reps.length === 0) {
    return (
      <p className="text-sm text-muted">
        No completed reps to analyse
        {noReps.length > 0 && ` — ${noReps.length} attempt${noReps.length > 1 ? "s" : ""} didn't pass the gates`}.
      </p>
    );
  }

  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const avgDepth = avg(reps.map((r) => r.depthDeg));
  const avgEcc = avg(reps.map((r) => r.eccentricMs));
  const avgCon = avg(reps.map((r) => r.concentricMs));
  const avgFlare = avg(reps.map((r) => r.flareDeg));
  const worstBody = Math.min(...reps.map((r) => r.bodyLineDeg));
  const tut = reps.reduce((a, r) => a + r.durationMs, 0);

  // Depth drift: the second half of the set against the first.
  const half = Math.floor(reps.length / 2);
  const drift =
    reps.length >= 6 ? avg(reps.slice(half).map((r) => r.depthDeg)) - avg(reps.slice(0, half).map((r) => r.depthDeg)) : 0;

  const fix = topFix({ avgDepth, avgEcc, avgFlare, worstBody, drift, noReps, config });

  // Chart space: from locked out (180°) down to a little past the gate.
  const floor = Math.min(config.bottomAngle - 15, ...reps.map((r) => r.depthDeg)) - 3;
  const top = 180;
  const y = (deg: number) => ((top - deg) / (top - floor)) * 100;
  const colWidth = 100 / reps.length;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <h3 className="display text-lg">Form report</h3>
        <span className="tabular text-xs text-muted">{reps.length} counted · {noReps.length} no-rep</span>
      </div>

      <div className="panel mt-3 p-3">
        <div className="flex items-center justify-between text-[10px] text-muted">
          <span className="display tracking-[0.12em]">DEPTH PER REP</span>
          <span className="display tracking-[0.12em]">DEEPER ↓</span>
        </div>

        <div className="relative mt-2 h-28 w-full">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
            {/* the gate you have to break */}
            <line
              x1="0"
              x2="100"
              y1={y(config.bottomAngle)}
              y2={y(config.bottomAngle)}
              stroke="#ffffff"
              strokeWidth="0.6"
              strokeDasharray="2 1.5"
              opacity="0.55"
              vectorEffect="non-scaling-stroke"
            />
            {reps.map((r, i) => {
              const h = Math.max(1.5, y(r.depthDeg));
              const margin = config.bottomAngle - r.depthDeg;
              const colour = margin >= 12 ? "#24e07f" : margin >= 4 ? "#9be36a" : "#f0b429";
              return (
                <rect
                  key={i}
                  x={i * colWidth + colWidth * 0.16}
                  y={0}
                  width={colWidth * 0.68}
                  height={h}
                  rx={colWidth * 0.2}
                  fill={colour}
                />
              );
            })}
          </svg>
          <span
            className="tabular pointer-events-none absolute left-0 -translate-y-1/2 rounded bg-ink px-1 text-[9px] text-muted"
            style={{ top: `${y(config.bottomAngle)}%` }}
          >
            {config.bottomAngle}°
          </span>
        </div>

        <div className="mt-3 flex items-center justify-between text-[10px] text-muted">
          <span className="display tracking-[0.12em]">TEMPO — LOWERING vs PRESSING</span>
        </div>
        <div className="mt-1.5 flex gap-[2px]">
          {reps.map((r, i) => {
            const total = Math.max(1, r.eccentricMs + r.concentricMs);
            return (
              <div key={i} className="flex h-2.5 flex-1 overflow-hidden rounded-sm bg-line" title={`Rep ${r.index}`}>
                <div style={{ width: `${(r.eccentricMs / total) * 100}%`, background: "#6aa8ff" }} />
                <div style={{ width: `${(r.concentricMs / total) * 100}%`, background: "#c77dff" }} />
              </div>
            );
          })}
        </div>
        <div className="mt-1.5 flex gap-4 text-[10px] text-muted">
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "#6aa8ff" }} /> lowering
          </span>
          <span className="flex items-center gap-1">
            <i className="inline-block h-2 w-2 rounded-sm" style={{ background: "#c77dff" }} /> pressing
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <Cell label="Avg depth" value={`${Math.round(avgDepth)}°`} note={`gate ${config.bottomAngle}°`} />
        <Cell label="Lowering" value={`${(avgEcc / 1000).toFixed(1)}s`} note={avgEcc < 500 ? "rushed" : "good"} />
        <Cell label="Pressing" value={`${(avgCon / 1000).toFixed(1)}s`} />
        <Cell label="Under tension" value={`${(tut / 1000).toFixed(0)}s`} />
      </div>

      <div className="mt-3 rounded-xl border border-you/35 bg-you/5 p-4">
        <p className="display text-xs tracking-[0.15em] text-you">WHAT TO FIX</p>
        <p className="mt-1 text-sm leading-relaxed">{fix}</p>
      </div>
    </div>
  );
}

function Cell({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-ink-2 px-3 py-3">
      <p className="display text-[10px] tracking-[0.14em] text-muted">{label.toUpperCase()}</p>
      <p className="display tabular mt-0.5 text-xl">{value}</p>
      {note && <p className="text-[10px] text-muted">{note}</p>}
    </div>
  );
}

/** One instruction, chosen by which signal is furthest out of line. */
function topFix(a: {
  avgDepth: number;
  avgEcc: number;
  avgFlare: number;
  worstBody: number;
  drift: number;
  noReps: NoRepEvent[];
  config: CounterConfig;
}): string {
  const counts = a.noReps.reduce<Record<string, number>>((m, n) => ({ ...m, [n.reason]: (m[n.reason] ?? 0) + 1 }), {});
  const worstReason = Object.entries(counts).sort((x, y) => y[1] - x[1])[0];

  if (worstReason && worstReason[1] >= 2) {
    const [reason, n] = worstReason;
    if (reason === "shallow")
      return `${n} attempts stopped short of ${a.config.bottomAngle}°. Touch your chest to a fist on the floor to calibrate how far down that actually is.`;
    if (reason === "hips")
      return `${n} attempts lost the body line. Squeeze your glutes and brace before you lower — the hips drop first, then the count stops.`;
    if (reason === "fast")
      return `${n} attempts were faster than ${a.config.minRepMs}ms. You're bouncing off the floor rather than pressing off it.`;
    if (reason === "flare")
      return `${n} attempts had the elbows winging out. Point them back at about 45° to your ribs, not straight out to the sides.`;
    if (reason === "lost")
      return `Tracking dropped ${n} times. Move the camera so your whole side stays in frame for the full range of the rep.`;
  }

  if (a.avgEcc < 450)
    return `You're dropping in ${(a.avgEcc / 1000).toFixed(1)}s. Take two seconds on the way down — the lowering half is where the strength is built, and it's the half almost everyone skips.`;

  if (a.avgFlare > a.config.maxFlare)
    return `Elbows averaged ${Math.round(a.avgFlare)}° from your torso. Aim for 45°: it takes load off the shoulder joint and puts it on the muscle.`;

  if (a.drift > 8)
    return `Your depth shallowed by ${Math.round(a.drift)}° across the set. That's the honest end of it — stop the set there next time rather than adding reps that don't count.`;

  if (a.worstBody < a.config.bodyLineMin + 6)
    return `Body line got as low as ${a.worstBody}° at its worst. It held, but only just — brace harder on the last few.`;

  if (a.avgDepth > a.config.bottomAngle - 6)
    return `Clean set, but depth is sitting right on the ${a.config.bottomAngle}° line. A few more degrees gives you margin when you're tired.`;

  return "Nothing to fix. Depth, tempo, elbows and body line all held through the set — add reps or move to a harder variation.";
}

/** Synthetic-skeleton tests for the rep referee. Run: npm run test */
import { RepCounter } from "../src/lib/pose/repCounter";
import { computeElo, implausible } from "../src/lib/elo";
import type { Pt } from "../src/lib/pose/geometry";
import { SimulatedAthlete, syntheticSkeleton as skeleton } from "../src/lib/pose/simulator";

const IMAGE: Pt[] = (() => {
  const p: Pt[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 1 }));
  p[11] = p[12] = { x: 0.3, y: 0.5, visibility: 1 };
  p[23] = p[24] = { x: 0.7, y: 0.52, visibility: 1 };
  return p;
})();

/** Drives one descend/ascend cycle, sampling at 30fps. */
function rep(c: RepCounter, t: number, opts: { bottom: number; durMs: number; body?: number }) {
  const body = opts.body ?? 178;
  const steps = Math.max(4, Math.round(opts.durMs / 33));
  const half = Math.floor(steps / 2);
  for (let i = 0; i <= steps; i++) {
    const k = i <= half ? i / half : (steps - i) / (steps - half);
    const angle = 175 - (175 - opts.bottom) * k;
    t += opts.durMs / steps;
    c.update(skeleton(angle, body), IMAGE, t);
  }
  // Settle at full lockout so the state machine sees the top.
  for (let i = 0; i < 6; i++) {
    t += 33;
    c.update(skeleton(178, body), IMAGE, t);
  }
  return t;
}

let failures = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label} → got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

console.log("\nrep counter (ranked strictness)");
{
  const c = new RepCounter("ranked");
  let t = 1000;
  for (let i = 0; i < 3; i++) t = rep(c, t, { bottom: 80, durMs: 1200 });
  check("three clean deep reps count", [c.count, c.noReps.length], [3, 0]);
}
{
  const c = new RepCounter("ranked");
  rep(c, 1000, { bottom: 115, durMs: 1200 });
  check("half rep is a no-rep (shallow)", [c.count, c.noReps[0]?.reason], [0, "shallow"]);
}
{
  const c = new RepCounter("ranked");
  rep(c, 1000, { bottom: 60, durMs: 340 });
  check("bounced rep is a no-rep (fast)", [c.count, c.noReps[0]?.reason], [0, "fast"]);
}
{
  const c = new RepCounter("ranked");
  rep(c, 1000, { bottom: 80, durMs: 1200, body: 128 });
  check("sagging hips is a no-rep (hips)", [c.count, c.noReps[0]?.reason], [0, "hips"]);
}
{
  const c = new RepCounter("ranked");
  let t = 1000;
  // Drop out of frame at the bottom, reappear locked out at the top.
  for (const a of [175, 160, 145, 130, 115, 100]) c.update(skeleton(a, 178), IMAGE, (t += 33));
  for (let i = 0; i < 25; i++) c.update(null, null, (t += 33));
  rep(c, t, { bottom: 80, durMs: 1200 });
  check("vanishing mid-rep voids it (lost)", [c.count, c.noReps[0]?.reason], [1, "lost"]);
}
{
  const casual = new RepCounter("casual");
  const strict = new RepCounter("strict");
  rep(casual, 1000, { bottom: 98, durMs: 1000 });
  rep(strict, 1000, { bottom: 98, durMs: 1000 });
  check("98° depth: casual counts, strict does not", [casual.count, strict.count], [1, 0]);
}
{
  const c = new RepCounter("ranked");
  let t = 1000;
  for (let i = 0; i < 20; i++) t = rep(c, t, { bottom: 78, durMs: 900 });
  check("20 reps in a row, none dropped", c.count, 20);
}

console.log("\nready detection");
{
  const c = new RepCounter("ranked");
  let t = 1000;
  for (let i = 0; i < 60; i++) c.update(skeleton(175, 178), IMAGE, (t += 33));
  check("plank held 2s reads as ready", c.readyFor(1500, t), true);
  c.update(null, null, (t += 33));
  check("losing tracking clears ready", c.readyFor(1500, t), false);
}

console.log("\nelo");
{
  const even = { rating: 1000, matches: 30 };
  const win = computeElo(even, { ...even }, 20, 10);
  check("equal ratings, clear win gains points", win.aDelta > 0 && win.bDelta < 0, true);
  const blowout = computeElo(even, { ...even }, 30, 2);
  const squeaker = computeElo(even, { ...even }, 16, 15);
  check("blowout moves more than a squeaker", blowout.aDelta > squeaker.aDelta, true);
  const draw = computeElo(even, { ...even }, 12, 12);
  check("a draw between equals is ~zero", Math.abs(draw.aDelta) <= 1, true);
  const upset = computeElo({ rating: 800, matches: 30 }, { rating: 1400, matches: 30 }, 20, 10);
  check("beating a much higher rating pays more", upset.aDelta > win.aDelta, true);
  const placing = computeElo({ rating: 1000, matches: 0 }, even, 20, 10);
  check("placement matches move faster", placing.aDelta > win.aDelta, true);
  const ghost = computeElo(even, { ...even }, 20, 10, { ghost: true });
  check("ghost wins pay half", ghost.aDelta < win.aDelta && ghost.aDelta > 0, true);
}

console.log("\nfull pipeline (simulated athlete → referee)");
{
  // 60 seconds at 30fps through the exact path demo mode uses.
  const athlete = new SimulatedAthlete();
  const c = new RepCounter("ranked");
  let t = 1000;
  for (let i = 0; i < 60 * 30; i++) {
    t += 1000 / 30;
    const { world, image } = athlete.sample(t);
    c.update(world, image, t);
  }
  const gaps = c.reps.slice(1).map((r, i) => r.tMs - c.reps[i].tMs);

  check("produces a human number of reps in 60s", c.count >= 15 && c.count <= 45, true);
  check("rejects the deliberately bad ones", c.noReps.length > 0, true);
  check("every counted rep reached depth", c.reps.every((r) => r.depthDeg <= 95), true);
  check("no two reps closer than the tempo gate", gaps.every((g) => g >= 380), true);

  // The referee's own output must survive the floor the ladder applies.
  const timeline = c.reps.map((r) => Math.round(r.tMs - 1000));
  check("its own output passes the plausibility floor", implausible(timeline, 60, c.count), null);
}

console.log("\nplausibility floor");
{
  const clean = Array.from({ length: 20 }, (_, i) => i * 2500);
  check("a real 60s set passes", implausible(clean, 60, 20), null);
  check("count that disagrees with the timeline fails", implausible(clean, 60, 99), "count-mismatch");
  check("reps outside the window fail", implausible([0, 999_000], 60, 2), "out-of-window");
  check("sub-250ms cadence fails", implausible([0, 100, 200], 60, 3), "impossible-cadence");
  const spam = Array.from({ length: 200 }, (_, i) => i * 260);
  check("200 reps in 60s fails on rate", implausible(spam, 60, 200), "impossible-rate");
}

console.log(failures === 0 ? "\nall green\n" : `\n${failures} FAILING\n`);
process.exit(failures === 0 ? 0 : 1);

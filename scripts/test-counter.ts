/** Synthetic-skeleton tests for the rep referee. Run: npm run test */
import { RepCounter, type CounterConfig } from "../src/lib/pose/repCounter";
import { configFor, VARIATIONS } from "../src/lib/pose/variations";
import { computeElo, implausible } from "../src/lib/elo";
import { analyseFraming } from "../src/lib/coach/framing";
import {
  EMPTY_STATE, needsTest, planFor, recordSession, today, weekOf,
  todayTotal, setsToday, dailySeries, toCsv, progressionHint, lifetimeReps,
  type TrainingState,
} from "../src/lib/training";
import type { Pt } from "../src/lib/pose/geometry";
import { SimulatedAthlete, syntheticSkeleton as skeleton } from "../src/lib/pose/simulator";

const IMAGE: Pt[] = (() => {
  const p: Pt[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 1 }));
  p[11] = p[12] = { x: 0.3, y: 0.5, visibility: 1 };
  p[23] = p[24] = { x: 0.7, y: 0.52, visibility: 1 };
  return p;
})();

/** A body that is straight to the knee but has the shins folded up, as in a real knee push-up. */
function kneeSkeleton(elbowDeg: number): Pt[] {
  const pts = skeleton(elbowDeg, 178, 45);
  pts[25] = pts[26] = { x: 0.9, y: 0, z: 0, visibility: 1 };
  pts[27] = pts[28] = { x: 0.9, y: -0.4, z: 0, visibility: 1 };
  return pts;
}

/** Drives one descend/ascend cycle, sampling at 30fps. */
function rep(
  c: RepCounter,
  t: number,
  opts: { bottom: number; durMs: number; body?: number; flare?: number; pose?: (e: number) => Pt[]; ecc?: number },
) {
  const body = opts.body ?? 178;
  const flare = opts.flare ?? 45;
  const pose = opts.pose ?? ((e: number) => skeleton(e, body, flare));
  const steps = Math.max(4, Math.round(opts.durMs / 33));
  // `ecc` splits the cycle: 0.5 is symmetric, 0.75 spends three quarters lowering.
  const half = Math.max(1, Math.round(steps * (opts.ecc ?? 0.5)));
  for (let i = 0; i <= steps; i++) {
    const k = i <= half ? i / half : Math.max(0, (steps - i) / Math.max(1, steps - half));
    const angle = 175 - (175 - opts.bottom) * k;
    t += opts.durMs / steps;
    c.update(pose(angle), IMAGE, t);
  }
  // Settle at full lockout so the state machine sees the top.
  for (let i = 0; i < 6; i++) {
    t += 33;
    c.update(pose(178), IMAGE, t);
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

console.log("\nelbow flare");
{
  const ranked = new RepCounter("ranked");
  rep(ranked, 1000, { bottom: 80, durMs: 1200, flare: 92 });
  check("flared rep still counts under ranked rules", [ranked.count, ranked.noReps.length], [1, 0]);
  check("but the flare is recorded on the rep", (ranked.reps[0]?.flareDeg ?? 0) >= 85, true);

  // Well past strict's 85° gate, so flare is the only thing left to decide it.
  const strict = new RepCounter("strict");
  rep(strict, 1000, { bottom: 72, durMs: 1200, flare: 92 });
  check("strict rules void it", [strict.count, strict.noReps[0]?.reason], [0, "flare"]);

  const tucked = new RepCounter("strict");
  rep(tucked, 1000, { bottom: 72, durMs: 1200, flare: 42 });
  check("tucked elbows pass strict", tucked.count, 1);
}

console.log("\ntempo split");
{
  const c = new RepCounter("ranked");
  rep(c, 1000, { bottom: 78, durMs: 2400, ecc: 0.75 });
  const r = c.reps[0];
  check("a slow negative is measured as such", !!r && r.eccentricMs > r.concentricMs * 1.6, true);
  check("the two halves add up to the rep", !!r && Math.abs(r.eccentricMs + r.concentricMs - r.durationMs) <= 40, true);
}

console.log("\nvariations");
{
  const onAnkle = new RepCounter(configFor("ranked", "standard"));
  rep(onAnkle, 1000, { bottom: 80, durMs: 1200, pose: kneeSkeleton });
  check("knee push-up fails the standard body line", [onAnkle.count, onAnkle.noReps[0]?.reason], [0, "hips"]);

  const onKnee = new RepCounter(configFor("ranked", "knee"));
  rep(onKnee, 1000, { bottom: 80, durMs: 1200, pose: kneeSkeleton });
  check("the knee variation counts it", onKnee.count, 1);

  check("exactly one variation is ranked", VARIATIONS.filter((v) => v.ranked).length, 1);
  const diamond: CounterConfig = configFor("ranked", "diamond");
  check("diamond tightens the flare allowance", diamond.maxFlare < configFor("ranked", "standard").maxFlare, true);
}

console.log("\nframing coach");
{
  /** Builds image-space landmarks from explicit joint positions. */
  const img = (j: Record<number, [number, number]>): Pt[] => {
    const p: Pt[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
    for (const [i, [x, y]] of Object.entries(j)) {
      p[Number(i)] = { x, y, visibility: 1 };
      // Mirror onto the other side of the pair so midpoints resolve.
      const partner = Number(i) % 2 === 1 ? Number(i) + 1 : Number(i) - 1;
      p[partner] = { x, y, visibility: 1 };
    }
    return p;
  };

  const good = img({ 15: [0.1, 0.8], 11: [0.22, 0.5], 23: [0.55, 0.52], 25: [0.72, 0.6], 27: [0.9, 0.75] });
  check("a good side-on setup passes", analyseFraming(good).issue, "ok");

  check("nothing in frame", analyseFraming(null).issue, "no-one");

  const standing = img({ 15: [0.5, 0.7], 11: [0.5, 0.25], 23: [0.5, 0.6], 25: [0.5, 0.8], 27: [0.5, 0.95] });
  check("camera in front of them", analyseFraming(standing).issue, "face-on");

  const legsOut = img({ 15: [0.1, 0.8], 11: [0.25, 0.5], 23: [0.8, 0.52] });
  check("legs out of shot", analyseFraming(legsOut).issue, "tail-cropped");

  const tiny = img({ 15: [0.44, 0.55], 11: [0.48, 0.5], 23: [0.6, 0.51], 25: [0.64, 0.53], 27: [0.68, 0.56] });
  check("too far away", analyseFraming(tiny).issue, "too-far");

  const huge = img({ 15: [0.01, 0.9], 11: [0.2, 0.4], 23: [0.6, 0.45], 25: [0.8, 0.6], 27: [0.99, 0.8] });
  check("too close to fit", analyseFraming(huge).issue, "too-close");

  // A knee push-up has no ankle in shot by design; the knee has to satisfy it.
  const kneeOnly = img({ 15: [0.1, 0.8], 11: [0.24, 0.5], 23: [0.6, 0.52], 25: [0.85, 0.62] });
  check("knee variation accepts no ankle", analyseFraming(kneeOnly, "knee").issue, "ok");
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

console.log("\ntraining plan");
{
  const iso = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return today(d);
  };

  check("a new athlete is sent to test first", planFor(EMPTY_STATE).kind, "test");
  check("no max means a test is due", needsTest(EMPTY_STATE), true);

  const tested: TrainingState = { ...EMPTY_STATE, maxSet: 20, maxSetOn: iso(0) };
  check("a fresh max does not need retesting", needsTest(tested), false);
  check("three weeks later it does", needsTest({ ...tested, maxSetOn: iso(21) }), true);

  const first = planFor(tested);
  check("first prescription is volume", first.kind, "volume");
  check("volume is five sets", first.sets.length, 5);
  check("nothing is prescribed at or above the max", first.sets.every((s) => s.reps < tested.maxSet), true);
  check("but total work exceeds a single max set", first.totalReps > tested.maxSet, true);

  // Rotation: the stimulus changes with each completed session.
  const afterOne = recordSession(tested, { kind: "volume", reps: first.totalReps });
  check("second is a ladder", planFor(afterOne).kind, "ladder");
  const afterTwo = recordSession(afterOne, { kind: "ladder", reps: 40 });
  check("third is density", planFor(afterTwo).kind, "density");
  const afterThree = recordSession(afterTwo, { kind: "density", reps: 70 });
  check("then it rotates back", planFor(afterThree).kind, "volume");

  // Quick sets are the daily habit and there can be dozens; they must not
  // shuffle the prescription.
  let spammed = tested;
  for (let i = 0; i < 25; i++) spammed = recordSession(spammed, { kind: "groove", reps: 8 });
  check("quick sets don't advance the rotation", planFor(spammed).kind, "volume");
  check("but they do count as volume", planFor(spammed).kind === planFor(tested).kind, true);

  // Overload: the same athlete, six weeks on, gets more work.
  const later: TrainingState = { ...tested, maxSetOn: iso(14) };
  check("weeks are counted from the test", weekOf(later), 2);
  check("later weeks prescribe more", planFor(later).totalReps > first.totalReps, true);

  console.log("\nstreaks");
  const d1 = recordSession(EMPTY_STATE, { kind: "volume", reps: 30, date: iso(2) });
  const d2 = recordSession(d1, { kind: "volume", reps: 30, date: iso(1) });
  const d3 = recordSession(d2, { kind: "volume", reps: 30, date: iso(0) });
  check("three consecutive days is a streak of 3", d3.streak, 3);

  const twice = recordSession(d3, { kind: "groove", reps: 8, date: iso(0) });
  check("two sessions in one day is still one day", twice.streak, 3);

  const broken = recordSession(EMPTY_STATE, { kind: "volume", reps: 30, date: iso(5) });
  check("a stale session is not a live streak", broken.streak, 0);
  check("best streak is remembered", recordSession(d3, { kind: "volume", reps: 1, date: iso(9) }).bestStreak, 3);

  const maxed = recordSession(tested, { kind: "test", reps: 26 });
  check("a test rebaselines the max", [maxed.maxSet, maxed.maxSetOn === today()], [26, true]);
}

console.log("\nthe day as the unit");
{
  const iso = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    return today(d);
  };

  // The pattern from the thread: many small sets across one day.
  let s: TrainingState = EMPTY_STATE;
  for (let i = 0; i < 16; i++) s = recordSession(s, { kind: "groove", reps: 25, date: iso(0) });

  check("sixteen sets of 25 is 400 today", todayTotal(s), 400);
  check("and counts as sixteen sets", setsToday(s), 16);
  check("but only one day of streak", s.streak, 1);
  check("max set is the set, not the day", s.maxSet, 25);

  const withYesterday = recordSession(s, { kind: "groove", reps: 30, date: iso(1) });
  check("yesterday is not in today's total", todayTotal(withYesterday), 400);
  check("lifetime counts everything", lifetimeReps(withYesterday), 430);

  const series = dailySeries(withYesterday, 7);
  check("series has one point per day", series.length, 7);
  check("gaps are filled with zeroes", series[0].reps, 0);
  check("today is last", [series[6].date === iso(0), series[6].reps], [true, 400]);
  check("best-of-day is the biggest set", series[6].best, 25);

  const csv = toCsv(recordSession(EMPTY_STATE, { kind: "test", reps: 21, date: iso(0) }));
  check("csv has a header and a row", csv.trim().split("\n").length, 2);
  check("csv row is date,kind,reps", csv.trim().split("\n")[1], `${iso(0)},test,21`);

  check("no hint below ten", progressionHint({ ...EMPTY_STATE, maxSet: 6 }, "knee"), null);
  check("knees get moved on at ten", (progressionHint({ ...EMPTY_STATE, maxSet: 12 }, "knee") ?? "").includes("incline"), true);
  check("standard gets pushed harder at 25", (progressionHint({ ...EMPTY_STATE, maxSet: 26 }, "standard") ?? "").includes("Diamond"), true);
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

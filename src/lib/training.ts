"use client";

/**
 * The part that answers "why is 40 push-ups a day doing nothing".
 *
 * Those are the two most-read push-up questions on Stack Exchange by a wide
 * margin, and the answer is always the same: a fixed daily number is not
 * progressive overload. So this prescribes sets against your tested max, moves
 * the target every week, rotates the stimulus, and re-tests on a cycle. It is
 * the reason to come back tomorrow, which a scoreboard on its own is not.
 */

export type SessionKind = "test" | "volume" | "ladder" | "density" | "groove";

export interface SetTarget {
  reps: number;
  restS: number;
}

export interface Session {
  kind: SessionKind;
  name: string;
  /** Shown to the athlete. Prescription without reasoning is just homework. */
  why: string;
  sets: SetTarget[];
  totalReps: number;
}

export interface TrainingState {
  /** Best single set to failure, and when it was measured. */
  maxSet: number;
  maxSetOn: string | null;
  /** Completed sessions, newest last. */
  history: Array<{ date: string; reps: number; kind: SessionKind }>;
  streak: number;
  bestStreak: number;
}

export const EMPTY_STATE: TrainingState = {
  maxSet: 0,
  maxSetOn: null,
  history: [],
  streak: 0,
  bestStreak: 0,
};

const KEY = "pug.training";
const RETEST_DAYS = 21;

export function today(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

export function loadTraining(): TrainingState {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...EMPTY_STATE, ...(JSON.parse(raw) as Partial<TrainingState>) };
  } catch {
    /* fall through */
  }
  return EMPTY_STATE;
}

export function saveTraining(s: TrainingState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* private browsing */
  }
}

/** Weeks of training completed since the max was set — drives the overload. */
export function weekOf(s: TrainingState): number {
  if (!s.maxSetOn) return 0;
  return Math.floor(Math.max(0, daysBetween(s.maxSetOn, today())) / 7);
}

export function needsTest(s: TrainingState): boolean {
  if (s.maxSet <= 0 || !s.maxSetOn) return true;
  return daysBetween(s.maxSetOn, today()) >= RETEST_DAYS;
}

const round = (n: number) => Math.max(1, Math.round(n));

/**
 * Today's prescription.
 *
 * Volume, ladder and density rotate so the stimulus changes; each week adds
 * 4% to the working percentages, which is the overload. Everything is a
 * fraction of a *tested* max rather than a guess, and nothing is taken to
 * failure except the test itself — going to failure daily is exactly the
 * mistake that produces the plateau.
 */
export function planFor(state: TrainingState): Session {
  if (needsTest(state)) {
    return {
      kind: "test",
      name: "Max set",
      why:
        state.maxSet > 0
          ? "Three weeks since your last test. Everything below is a percentage of this number, so it needs to be current."
          : "One set to failure, so every session after this is scaled to you rather than to a number off the internet.",
      sets: [{ reps: 0, restS: 0 }],
      totalReps: 0,
    };
  }

  const max = state.maxSet;
  const week = weekOf(state);
  const bump = 1 + Math.min(0.32, week * 0.04);
  const done = state.history.filter((h) => h.kind !== "test").length;

  switch (done % 3) {
    case 0: {
      const pcts = [0.65, 0.6, 0.55, 0.5, 0.5];
      const sets = pcts.map((p) => ({ reps: round(max * p * bump), restS: 90 }));
      return {
        kind: "volume",
        name: "Volume",
        why: `Five sets at roughly ${Math.round(65 * bump)}% down to ${Math.round(50 * bump)}% of your ${max}. Total work about ${Math.round(
          (sets.reduce((a, b) => a + b.reps, 0) / max) * 10,
        ) / 10}× your best set, none of it to failure.`,
        sets,
        totalReps: sets.reduce((a, b) => a + b.reps, 0),
      };
    }
    case 1: {
      const peak = Math.max(2, round(max * 0.45 * bump));
      const up = Array.from({ length: peak }, (_, i) => i + 1);
      const reps = [...up, ...up.slice(0, -1).reverse()];
      const sets = reps.map((r) => ({ reps: r, restS: Math.max(10, r * 4) }));
      return {
        kind: "ladder",
        name: "Ladder",
        why: `Up to ${peak} and back down, resting about four seconds per rep. Accumulates ${reps.reduce(
          (a, b) => a + b,
          0,
        )} reps while every single set stays easy.`,
        sets,
        totalReps: reps.reduce((a, b) => a + b, 0),
      };
    }
    default: {
      const per = Math.max(2, round(max * 0.35 * bump));
      const rounds = 10;
      return {
        kind: "density",
        name: "Every minute",
        why: `${per} reps at the top of each minute for ${rounds} minutes. The rest shrinks as you slow down, which is the point — same work, less recovery.`,
        sets: Array.from({ length: rounds }, () => ({ reps: per, restS: 60 })),
        totalReps: per * rounds,
      };
    }
  }
}

/** Sets at 40% of max, spread through the day, never near failure. */
export function grooveSet(state: TrainingState): number {
  return Math.max(1, Math.round(state.maxSet * 0.4));
}

export function recordSession(
  state: TrainingState,
  entry: { reps: number; kind: SessionKind; date?: string },
): TrainingState {
  const date = entry.date ?? today();
  const next: TrainingState = {
    ...state,
    history: [...state.history, { date, reps: entry.reps, kind: entry.kind }].slice(-400),
  };

  if (entry.kind === "test" || entry.reps > next.maxSet) {
    if (entry.kind === "test") {
      next.maxSet = entry.reps;
      next.maxSetOn = date;
    } else {
      next.maxSet = entry.reps;
    }
  }

  // A streak counts distinct days, not sessions — three sets on Tuesday is
  // still one day of showing up.
  const days = [...new Set(next.history.map((h) => h.date))].sort();
  let streak = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (i === days.length - 1) {
      const gap = daysBetween(days[i], today());
      if (gap > 1) break;
      streak = 1;
      continue;
    }
    if (daysBetween(days[i], days[i + 1]) === 1) streak += 1;
    else break;
  }
  next.streak = streak;
  next.bestStreak = Math.max(state.bestStreak, streak);

  return next;
}

export function volumeThisWeek(state: TrainingState): number {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 6);
  const from = today(cutoff);
  return state.history.filter((h) => h.date >= from).reduce((a, h) => a + h.reps, 0);
}

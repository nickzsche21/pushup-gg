"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { VARIATIONS, variation } from "@/lib/pose/variations";
import {
  EMPTY_STATE,
  loadTraining,
  needsTest,
  planFor,
  volumeThisWeek,
  weekOf,
  type Session,
  type TrainingState,
} from "@/lib/training";

export default function TrainPage() {
  const [state, setState] = useState<TrainingState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [vary, setVary] = useState("standard");

  useEffect(() => {
    const s = loadTraining();
    setState(s);
    setSession(planFor(s));
    setVary(localStorage.getItem("pug.variation") ?? "standard");
  }, []);

  const s = state ?? EMPTY_STATE;
  const testing = needsTest(s);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="display text-xl">
          PUSHUP<span className="text-you">.GG</span>
        </Link>
        <Link href="/leaderboard" className="display text-sm text-muted transition hover:text-text">
          Ladder →
        </Link>
      </header>

      <h1 className="display mt-10 text-4xl">Training</h1>
      <p className="mt-2 max-w-xl text-muted">
        Forty push-ups a day stops working almost immediately, which is the most-read complaint
        about push-ups anywhere. This prescribes work against your tested max, moves it every week,
        and rotates what it asks for.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
        <Stat label="Max set" value={s.maxSet > 0 ? String(s.maxSet) : "—"} note={s.maxSetOn ?? "untested"} />
        <Stat label="Streak" value={`${s.streak}d`} note={s.bestStreak > 0 ? `best ${s.bestStreak}d` : undefined} />
        <Stat label="Week" value={s.maxSet > 0 ? String(weekOf(s) + 1) : "—"} note="of this block" />
        <Stat label="7-day volume" value={String(volumeThisWeek(s))} note="reps" />
      </div>

      {session && (
        <section className="panel mt-6 p-5">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <p className="display text-xs tracking-[0.2em] text-you">{testing ? "START HERE" : "TODAY"}</p>
              <h2 className="display mt-0.5 text-3xl">{session.name}</h2>
            </div>
            {session.totalReps > 0 && (
              <span className="display tabular shrink-0 text-2xl text-muted">{session.totalReps} reps</span>
            )}
          </div>

          <p className="mt-3 text-sm leading-relaxed text-muted">{session.why}</p>

          {session.sets.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {session.sets.map((set, i) => (
                <span
                  key={i}
                  className="display tabular rounded-md border border-line bg-ink px-2.5 py-1 text-sm"
                  title={`Rest ${set.restS}s`}
                >
                  {set.reps}
                </span>
              ))}
            </div>
          )}

          <Link
            href={`/train/session?v=${vary}`}
            className="display mt-6 block rounded-lg bg-you py-3 text-center text-lg text-ink transition hover:brightness-110"
          >
            {testing ? "Test your max" : `Start — ${session.sets.length} set${session.sets.length > 1 ? "s" : ""}`}
          </Link>
        </section>
      )}

      <section className="mt-10">
        <h2 className="display text-2xl">Variation</h2>
        <p className="mt-1 text-sm text-muted">
          Only the knee version changes what the referee measures — its body line runs to the knee
          instead of the ankle. The rest keep the same gates and get their own records board.
        </p>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {VARIATIONS.map((v) => {
            const on = v.id === vary;
            return (
              <button
                key={v.id}
                onClick={() => {
                  setVary(v.id);
                  localStorage.setItem("pug.variation", v.id);
                }}
                className={`rounded-xl border p-4 text-left transition ${
                  on ? "border-you/60 bg-you/5" : "border-line bg-ink-2 hover:border-white/25"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="display text-lg">{v.name}</span>
                  <span
                    className="display rounded px-1.5 py-0.5 text-[9px] tracking-[0.12em]"
                    style={{
                      color: v.level === "beginner" ? "#24e07f" : v.level === "advanced" ? "#c77dff" : "#f0b429",
                      background:
                        v.level === "beginner" ? "#24e07f18" : v.level === "advanced" ? "#c77dff18" : "#f0b42918",
                    }}
                  >
                    {v.level.toUpperCase()}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{v.blurb}</p>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-xs text-muted">
          Selected: <span className="text-text">{variation(vary).name}</span>
          {variation(vary).ranked ? " — counts on the ranked ladder." : " — records board only."}
        </p>
      </section>

      {s.history.length > 0 && (
        <section className="mt-10">
          <h2 className="display text-2xl">Recent</h2>
          <ol className="mt-3 space-y-1.5">
            {[...s.history]
              .slice(-8)
              .reverse()
              .map((h, i) => (
                <li key={i} className="flex items-center justify-between rounded-lg border border-line bg-ink-2 px-4 py-2.5">
                  <span className="display text-sm capitalize">{h.kind}</span>
                  <span className="tabular text-xs text-muted">{h.date}</span>
                  <span className="display tabular text-lg">{h.reps}</span>
                </li>
              ))}
          </ol>
        </section>
      )}
    </main>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-ink-2 px-3 py-4">
      <p className="display text-[10px] tracking-[0.14em] text-muted">{label.toUpperCase()}</p>
      <p className="display tabular mt-0.5 text-2xl">{value}</p>
      {note && <p className="truncate text-[10px] text-muted">{note}</p>}
    </div>
  );
}

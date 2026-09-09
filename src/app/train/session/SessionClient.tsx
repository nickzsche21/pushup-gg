"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraStage from "@/components/CameraStage";
import FormReport from "@/components/FormReport";
import { Coach, loadCoachOptions, saveCoachOptions, type CoachOptions } from "@/lib/coach/audio";
import type { Framing } from "@/lib/coach/framing";
import type { NoRepEvent, RepEvent, Strictness } from "@/lib/pose/repCounter";
import { configFor, variation } from "@/lib/pose/variations";
import {
  loadTraining,
  planFor,
  recordSession,
  saveTraining,
  type Session,
  type TrainingState,
} from "@/lib/training";
import { cachedPlayer, submitResult, syncPlayer, type Player } from "@/lib/api";
import { handle as getHandle, playerId } from "@/lib/identity";

type Phase = "brief" | "position" | "live" | "rest" | "done";

const AMRAP_IDLE_MS = 10_000;

export default function SessionClient() {
  const params = useSearchParams();
  const variationId = params.get("v") ?? "standard";
  const strictness: Strictness = (params.get("s") as Strictness) ?? "ranked";
  const config = useMemo(() => configFor(strictness, variationId), [strictness, variationId]);

  const [state, setState] = useState<TrainingState | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [setIndex, setSetIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("brief");
  const [reps, setReps] = useState(0);
  const [restLeft, setRestLeft] = useState(0);
  const [framing, setFraming] = useState<Framing | null>(null);
  const [coachOpts, setCoachOpts] = useState<CoachOptions | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [inPosition, setInPosition] = useState(false);

  const coachRef = useRef<Coach | null>(null);
  const setRepsRef = useRef<RepEvent[]>([]);
  const allRepsRef = useRef<RepEvent[]>([]);
  const allNoRepsRef = useRef<NoRepEvent[]>([]);
  const startPerfRef = useRef(0);
  const lastRepAtRef = useRef(0);
  const timelineRef = useRef<number[]>([]);
  const doneRef = useRef(false);

  const target = session?.sets[setIndex]?.reps ?? 0;
  const isTest = session?.kind === "test";
  const lastSet = session ? setIndex >= session.sets.length - 1 : true;

  useEffect(() => {
    const s = loadTraining();
    setState(s);
    setSession(planFor(s));

    const id = playerId();
    const h = getHandle();
    setPlayer(cachedPlayer(id, h));
    void syncPlayer(id, h).then(setPlayer);

    const opts = loadCoachOptions();
    setCoachOpts(opts);
    const coach = new Coach(opts);
    coachRef.current = coach;
    const arm = () => void coach.arm();
    window.addEventListener("pointerdown", arm, { once: true });
    window.addEventListener("keydown", arm, { once: true });
    return () => {
      window.removeEventListener("pointerdown", arm);
      window.removeEventListener("keydown", arm);
      coach.dispose();
    };
  }, []);

  const setCoach = (next: CoachOptions) => {
    setCoachOpts(next);
    saveCoachOptions(next);
    if (coachRef.current) coachRef.current.options = next;
    void coachRef.current?.arm();
  };

  // ---- finishing a set ---------------------------------------------------
  const endSet = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;

    const counted = setRepsRef.current.length;
    allRepsRef.current.push(...setRepsRef.current);
    coachRef.current?.finish(isTest ? `${counted} reps. That is your new max.` : `Set done. ${counted} reps.`);

    if (lastSet) {
      void completeSession();
      return;
    }
    const rest = session?.sets[setIndex]?.restS ?? 60;
    setRestLeft(rest);
    setPhase("rest");
  }, [isTest, lastSet, session, setIndex]);

  const completeSession = useCallback(async () => {
    setPhase("done");
    const total = allRepsRef.current.length;
    const kind = session?.kind ?? "volume";

    const base = loadTraining();
    const next = recordSession(base, { kind, reps: isTest ? total : total });
    saveTraining(next);
    setState(next);

    // A max test is a real set to failure, so it belongs on the records board.
    if (isTest && player && total > 0) {
      await submitResult({
        matchId: crypto.randomUUID(),
        mode: "solo",
        durationS: 0,
        me: player,
        myReps: total,
        myNoReps: allNoRepsRef.current.length,
        timeline: timelineRef.current,
        variation: variationId,
      });
    }
  }, [isTest, player, session]);

  // ---- live clock --------------------------------------------------------
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      const now = performance.now();
      if (isTest || target === 0) {
        const since = lastRepAtRef.current ? now - lastRepAtRef.current : now - startPerfRef.current;
        if ((lastRepAtRef.current && since > AMRAP_IDLE_MS) || (!lastRepAtRef.current && since > 25_000)) endSet();
      }
    }, 150);
    return () => clearInterval(t);
  }, [phase, isTest, target, endSet]);

  // ---- rest clock --------------------------------------------------------
  useEffect(() => {
    if (phase !== "rest") return;
    const t = setInterval(() => {
      setRestLeft((r) => {
        if (r <= 1) {
          clearInterval(t);
          nextSet();
          return 0;
        }
        if (r === 4) coachRef.current?.say("Three seconds");
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const nextSet = useCallback(() => {
    setSetIndex((i) => i + 1);
    setReps(0);
    setRepsRef.current = [];
    doneRef.current = false;
    setPhase("position");
  }, []);

  const beginSet = () => {
    setReps(0);
    setRepsRef.current = [];
    doneRef.current = false;
    setPhase("position");
  };

  const handleInPosition = useCallback(
    (ready: boolean) => {
      setInPosition(ready);
      if (!ready || phase !== "position") return;
      startPerfRef.current = performance.now();
      lastRepAtRef.current = 0;
      coachRef.current?.countdown(0);
      setPhase("live");
    },
    [phase],
  );

  const onRep = useCallback(
    (r: RepEvent) => {
      setRepsRef.current.push(r);
      timelineRef.current.push(Math.round(r.tMs - startPerfRef.current));
      lastRepAtRef.current = r.tMs;
      const n = setRepsRef.current.length;
      setReps(n);

      // Count down toward the target — chunking is what gets people through a set.
      coachRef.current?.rep(target > 0 ? Math.max(0, target - n) : n);
      if (target > 0 && n >= target) setTimeout(endSet, 250);
    },
    [target, endSet],
  );

  const onNoRep = useCallback((n: NoRepEvent) => {
    allNoRepsRef.current.push(n);
    coachRef.current?.noRep(n.reason);
  }, []);

  const onFault = useCallback((fault: "hips" | "flare" | null) => {
    if (fault === "hips") coachRef.current?.cue("Straighten your body");
    else if (fault === "flare") coachRef.current?.cue("Tuck your elbows in");
  }, []);

  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-you" />
      </main>
    );
  }

  const remaining = target > 0 ? Math.max(0, target - reps) : reps;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black">
      {phase !== "done" && phase !== "brief" && (
        <CameraStage
          config={config}
          armed={phase === "live"}
          onRep={onRep}
          onNoRep={onNoRep}
          onFault={onFault}
          onFraming={setFraming}
          onInPosition={handleInPosition}
        />
      )}

      {phase === "live" && (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
            <div className="hud mx-auto flex max-w-md items-center justify-between rounded-2xl px-4 py-3">
              <div>
                <p className="display text-[10px] tracking-[0.2em] text-muted">
                  SET {setIndex + 1} OF {session.sets.length}
                </p>
                <p className="display text-xl leading-none">{session.name}</p>
              </div>
              <div className="text-right">
                <p className="display text-[10px] tracking-[0.2em] text-muted">
                  {target > 0 ? "TO GO" : "COUNTED"}
                </p>
                <p className="display tabular text-3xl leading-none text-you">{remaining}</p>
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center pb-8">
            <p
              key={reps}
              className="display pop text-[5.5rem] leading-[0.8] text-white sm:text-[7rem]"
              style={{ textShadow: "0 6px 40px rgba(0,0,0,0.85)" }}
            >
              {remaining}
            </p>
            {isTest && <p className="display text-sm text-muted">to failure — stop when the reps stop counting</p>}
          </div>
          {target === 0 || isTest ? (
            <button
              onClick={endSet}
              className="display absolute bottom-6 right-5 z-30 rounded-lg border border-line bg-ink/80 px-4 py-2 text-sm"
            >
              End set
            </button>
          ) : null}
        </>
      )}

      {phase === "brief" && (
        <Overlay>
          <p className="display text-xs tracking-[0.2em] text-you">{session.name.toUpperCase()}</p>
          <h1 className="display mt-1 text-4xl">
            {isTest ? "One set to failure" : `${session.sets.length} sets · ${session.totalReps} reps`}
          </h1>
          <p className="mx-auto mt-3 max-w-sm text-sm leading-relaxed text-muted">{session.why}</p>
          {variationId !== "standard" && (
            <p className="display mt-3 text-xs tracking-[0.15em] text-gold">
              {variation(variationId).name.toUpperCase()} PUSH-UPS
            </p>
          )}
          <button
            onClick={beginSet}
            className="display mt-7 w-full max-w-xs rounded-lg bg-you py-3 text-lg text-ink transition hover:brightness-110"
          >
            {isTest ? "Start the test" : `Start set 1 — ${session.sets[0]?.reps} reps`}
          </button>
          {coachOpts && (
            <button
              onClick={() => setCoach({ ...coachOpts, speak: !coachOpts.speak, tones: !coachOpts.speak })}
              className="display mt-3 rounded-lg border border-line px-4 py-2 text-sm"
            >
              {coachOpts.speak ? "🔊 Coach on" : "🔇 Coach off"}
            </button>
          )}
          <Link href="/train" className="display mt-6 block text-sm text-muted hover:text-text">
            Back
          </Link>
        </Overlay>
      )}

      {phase === "position" && (
        <Overlay>
          <p className="display text-xs tracking-[0.2em] text-muted">
            SET {setIndex + 1} OF {session.sets.length}
            {target > 0 && ` · ${target} REPS`}
          </p>
          <p className="display mt-1 text-4xl">
            {inPosition ? "Go" : framing && framing.issue !== "ok" ? "Fix the camera" : "Get into position"}
          </p>
          <p className="mx-auto mt-3 max-w-sm text-muted">
            {framing && framing.issue !== "ok"
              ? framing.hint
              : "Arms locked out, body in one line. It starts on its own."}
          </p>
        </Overlay>
      )}

      {phase === "rest" && (
        <Overlay>
          <p className="display text-xs tracking-[0.2em] text-muted">REST</p>
          <p className="display tabular text-[5.5rem] leading-none text-you sm:text-[7rem]">{restLeft}</p>
          <p className="mt-1 text-muted">
            Set {setIndex + 2} of {session.sets.length} — {session.sets[setIndex + 1]?.reps} reps
          </p>
          <button
            onClick={() => {
              setRestLeft(0);
              nextSet();
            }}
            className="display mt-6 rounded-lg border border-line px-5 py-2 text-sm"
          >
            Skip rest
          </button>
        </Overlay>
      )}

      {phase === "done" && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-ink/95 px-5 py-10 backdrop-blur">
          <div className="rise mx-auto max-w-md">
            <p className="display text-center text-5xl text-you">DONE</p>
            <p className="display mt-1 text-center text-lg text-muted">
              {allRepsRef.current.length} reps · {session.name}
            </p>

            <div className="mt-6 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
              <Cell label="Reps" value={String(allRepsRef.current.length)} />
              <Cell label="Max set" value={state ? String(state.maxSet) : "—"} />
              <Cell label="Streak" value={state ? `${state.streak}d` : "—"} />
            </div>

            <div className="mt-6">
              <FormReport reps={allRepsRef.current} noReps={allNoRepsRef.current} config={config} />
            </div>

            <Link
              href="/train"
              className="display mt-7 block rounded-lg bg-you py-3 text-center text-lg text-ink transition hover:brightness-110"
            >
              Back to training
            </Link>
            <Link href="/" className="display mt-3 block text-center text-sm text-muted hover:text-text">
              Home
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/85 px-6 text-center backdrop-blur-sm">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-ink-2 px-2 py-4 text-center">
      <p className="display text-[10px] tracking-[0.14em] text-muted">{label.toUpperCase()}</p>
      <p className="display tabular mt-0.5 text-2xl">{value}</p>
    </div>
  );
}

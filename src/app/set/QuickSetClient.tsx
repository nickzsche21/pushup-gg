"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraStage from "@/components/CameraStage";
import FormReport from "@/components/FormReport";
import { Coach, loadCoachOptions, saveCoachOptions, type CoachOptions } from "@/lib/coach/audio";
import type { Framing } from "@/lib/coach/framing";
import type { NoRepEvent, RepEvent, Strictness } from "@/lib/pose/repCounter";
import { STRICTNESS } from "@/lib/pose/repCounter";
import { configFor, variation, VARIATIONS } from "@/lib/pose/variations";
import {
  loadTraining,
  progressionHint,
  recordSession,
  saveTraining,
  setsToday,
  todayTotal,
  type TrainingState,
} from "@/lib/training";
import { cachedPlayer, submitResult, syncPlayer, type Player } from "@/lib/api";
import { handle as getHandle, playerId } from "@/lib/identity";

type Phase = "position" | "live" | "summary";

const IDLE_END_MS = 10_000;

const STRICT_COPY: Record<Strictness, { name: string; blurb: string }> = {
  casual: { name: "Casual", blurb: "Counts almost anything that moves. For building the habit." },
  ranked: { name: "Ranked", blurb: "The real gates. What the ladder uses." },
  strict: { name: "Strict", blurb: "Deep, slow, elbows tucked. Nothing sloppy survives." },
};

/**
 * One set, no ceremony.
 *
 * The stated reason people abandon push-up programmes is administrative faff,
 * so this has no briefing screen, no target and no navigation between sets:
 * the camera stays live and "another set" drops straight back into position.
 * It is built for the pattern that actually produces volume — sixteen sets of
 * twenty-five across a day, rather than one heroic session.
 */
export default function QuickSetClient() {
  const params = useSearchParams();
  const [strictness, setStrictness] = useState<Strictness>((params.get("s") as Strictness) ?? "ranked");
  const [variationId, setVariationId] = useState(params.get("v") ?? "standard");
  const config = useMemo(() => configFor(strictness, variationId), [strictness, variationId]);

  const [phase, setPhase] = useState<Phase>("position");
  const [reps, setReps] = useState(0);
  const [lastSet, setLastSet] = useState(0);
  const [state, setState] = useState<TrainingState | null>(null);
  const [framing, setFraming] = useState<Framing | null>(null);
  const [coachOpts, setCoachOpts] = useState<CoachOptions | null>(null);
  const [player, setPlayer] = useState<Player | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const coachRef = useRef<Coach | null>(null);
  const setRepsRef = useRef<RepEvent[]>([]);
  const setNoRepsRef = useRef<NoRepEvent[]>([]);
  const timelineRef = useRef<number[]>([]);
  const startPerfRef = useRef(0);
  const lastRepAtRef = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    setState(loadTraining());

    const id = playerId();
    const h = getHandle();
    setPlayer(cachedPlayer(id, h));
    void syncPlayer(id, h).then(setPlayer);

    const stored = localStorage.getItem("pug.variation");
    if (stored && !params.get("v")) setVariationId(stored);
    const sStored = localStorage.getItem("pug.strictness") as Strictness | null;
    if (sStored && STRICTNESS[sStored] && !params.get("s")) setStrictness(sStored);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const endSet = useCallback(async () => {
    if (endedRef.current) return;
    endedRef.current = true;

    const counted = setRepsRef.current.length;
    setLastSet(counted);
    setPhase("summary");
    coachRef.current?.finish(counted > 0 ? `${counted} reps` : undefined);

    if (counted === 0) return;

    const base = loadTraining();
    const next = recordSession(base, { kind: "groove", reps: counted });
    saveTraining(next);
    setState(next);

    // A single camera-judged set is exactly what the records board is for.
    if (player) {
      await submitResult({
        matchId: crypto.randomUUID(),
        mode: "solo",
        durationS: 0,
        me: player,
        myReps: counted,
        myNoReps: setNoRepsRef.current.length,
        timeline: timelineRef.current,
        variation: variationId,
      });
    }
  }, [player, variationId]);

  // AMRAP: the set is over ten seconds after the last rep that counted.
  useEffect(() => {
    if (phase !== "live") return;
    const t = setInterval(() => {
      const now = performance.now();
      const since = lastRepAtRef.current ? now - lastRepAtRef.current : now - startPerfRef.current;
      if ((lastRepAtRef.current && since > IDLE_END_MS) || (!lastRepAtRef.current && since > 30_000)) void endSet();
    }, 200);
    return () => clearInterval(t);
  }, [phase, endSet]);

  const handleInPosition = useCallback(
    (ready: boolean) => {
      if (!ready || phase !== "position") return;
      startPerfRef.current = performance.now();
      lastRepAtRef.current = 0;
      coachRef.current?.countdown(0);
      setPhase("live");
    },
    [phase],
  );

  const onRep = useCallback((r: RepEvent) => {
    setRepsRef.current.push(r);
    timelineRef.current.push(Math.round(r.tMs - startPerfRef.current));
    lastRepAtRef.current = r.tMs;
    setReps(setRepsRef.current.length);
    coachRef.current?.rep(setRepsRef.current.length);
  }, []);

  const onNoRep = useCallback((n: NoRepEvent) => {
    setNoRepsRef.current.push(n);
    coachRef.current?.noRep(n.reason);
  }, []);

  const onFault = useCallback((fault: "hips" | "flare" | null) => {
    if (fault === "hips") coachRef.current?.cue("Straighten your body");
    else if (fault === "flare") coachRef.current?.cue("Tuck your elbows in");
  }, []);

  /** Straight back into position — the camera never goes away. */
  const again = () => {
    setRepsRef.current = [];
    setNoRepsRef.current = [];
    timelineRef.current = [];
    setReps(0);
    endedRef.current = false;
    setPhase("position");
  };

  const dayTotal = state ? todayTotal(state) : 0;
  const daySets = state ? setsToday(state) : 0;
  const hint = state ? progressionHint(state, variationId) : null;

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black">
      <CameraStage
        config={config}
        armed={phase === "live"}
        onRep={onRep}
        onNoRep={onNoRep}
        onFault={onFault}
        onFraming={setFraming}
        onInPosition={handleInPosition}
      />

      {/* Today's running total sits above everything, always. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-20 p-3">
        <div className="hud mx-auto flex max-w-md items-center justify-between rounded-2xl px-4 py-2.5">
          <div>
            <p className="display text-[10px] tracking-[0.2em] text-muted">TODAY</p>
            <p className="display tabular text-2xl leading-none">
              {dayTotal + (phase === "live" ? reps : 0)}
              <span className="ml-1.5 text-xs text-muted">
                in {daySets + (phase === "live" ? 1 : 0)} set{daySets + (phase === "live" ? 1 : 0) === 1 ? "" : "s"}
              </span>
            </p>
          </div>
          <div className="text-right">
            <p className="display text-[10px] tracking-[0.2em] text-muted">STREAK</p>
            <p className="display tabular text-2xl leading-none text-you">{state?.streak ?? 0}d</p>
          </div>
        </div>
      </div>

      {phase === "live" && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col items-center pb-8">
          <p
            key={reps}
            className="display pop text-[6rem] leading-[0.8] text-white sm:text-[7.5rem]"
            style={{ textShadow: "0 6px 40px rgba(0,0,0,0.85)" }}
          >
            {reps}
          </p>
          <p className="display mt-1 text-xs tracking-[0.15em] text-muted">
            STOPS ON ITS OWN 10s AFTER YOUR LAST REP
          </p>
        </div>
      )}

      {phase === "live" && (
        <button
          onClick={() => void endSet()}
          className="display absolute bottom-6 right-5 z-30 rounded-lg border border-line bg-ink/80 px-4 py-2 text-sm"
        >
          End set
        </button>
      )}

      {phase === "position" && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-ink/70 px-6 text-center backdrop-blur-[2px]">
          <div className="w-full max-w-sm">
            <p className="display text-3xl">
              {framing && framing.issue !== "ok" ? "Fix the camera" : "Get into position"}
            </p>
            <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
              {framing && framing.issue !== "ok"
                ? framing.hint
                : "It starts on its own once you're in a plank. No countdown, no buttons."}
            </p>

            <button
              onClick={() => setShowSettings((v) => !v)}
              className="display mt-6 text-xs tracking-[0.15em] text-muted underline decoration-line underline-offset-4"
            >
              {variation(variationId).name.toUpperCase()} · {STRICT_COPY[strictness].name.toUpperCase()}
            </button>

            {showSettings && (
              <div className="panel mt-3 p-3 text-left">
                <p className="display text-[10px] tracking-[0.15em] text-muted">HOW STRICT</p>
                <div className="mt-1.5 flex gap-1.5">
                  {(Object.keys(STRICT_COPY) as Strictness[]).map((k) => (
                    <button
                      key={k}
                      onClick={() => {
                        setStrictness(k);
                        localStorage.setItem("pug.strictness", k);
                      }}
                      className={`display flex-1 rounded-md border px-2 py-1.5 text-xs transition ${
                        k === strictness ? "border-you/60 bg-you/10 text-you" : "border-line text-muted"
                      }`}
                    >
                      {STRICT_COPY[k].name}
                    </button>
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{STRICT_COPY[strictness].blurb}</p>

                <p className="display mt-3 text-[10px] tracking-[0.15em] text-muted">VARIATION</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {VARIATIONS.map((v) => (
                    <button
                      key={v.id}
                      onClick={() => {
                        setVariationId(v.id);
                        localStorage.setItem("pug.variation", v.id);
                      }}
                      className={`display rounded-md border px-2 py-1 text-[11px] transition ${
                        v.id === variationId ? "border-you/60 bg-you/10 text-you" : "border-line text-muted"
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </div>

                {coachOpts && (
                  <button
                    onClick={() => {
                      const next = { ...coachOpts, speak: !coachOpts.speak, tones: !coachOpts.speak };
                      setCoachOpts(next);
                      saveCoachOptions(next);
                      if (coachRef.current) coachRef.current.options = next;
                      void coachRef.current?.arm();
                    }}
                    className="display mt-3 w-full rounded-md border border-line px-3 py-1.5 text-xs"
                  >
                    {coachOpts.speak ? "🔊 Coach on" : "🔇 Coach off"}
                  </button>
                )}
              </div>
            )}

            <Link href="/train" className="display mt-6 block text-sm text-muted hover:text-text">
              Done for now
            </Link>
          </div>
        </div>
      )}

      {phase === "summary" && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-ink/95 px-5 py-8 backdrop-blur">
          <div className="rise mx-auto max-w-md text-center">
            <p className="display tabular text-[5rem] leading-none text-you">{lastSet}</p>
            <p className="display text-lg text-muted">
              {lastSet === 0 ? "nothing counted" : `reps · ${dayTotal} today in ${daySets} sets`}
            </p>

            {hint && (
              <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-left text-sm text-gold">
                {hint}
              </p>
            )}

            <button
              onClick={again}
              className="display mt-6 w-full rounded-lg bg-you py-3.5 text-lg text-ink transition hover:brightness-110"
            >
              Another set
            </button>
            <Link
              href="/train"
              className="display mt-3 block rounded-lg border border-line py-3 transition hover:border-white/30"
            >
              Done for today
            </Link>

            {lastSet > 0 && (
              <div className="mt-7 text-left">
                <FormReport reps={setRepsRef.current} noReps={setNoRepsRef.current} config={config} />
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}

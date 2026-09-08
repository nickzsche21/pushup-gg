"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CameraStage from "@/components/CameraStage";
import MatchHud, { type Side } from "@/components/MatchHud";
import { RankBadge } from "@/components/RankBadge";
import { cachedPlayer, submitResult, syncPlayer, type Player } from "@/lib/api";
import { handle as getHandle, playerId } from "@/lib/identity";
import type { NoRepEvent, NoRepReason, RepEvent, Strictness } from "@/lib/pose/repCounter";
import {
  joinRoom,
  newRoomCode,
  peersIn,
  queueForMatch,
  sendFinal,
  sendGo,
  sendReady,
  sendState,
  type Found,
  type GhostRun,
  type PeerInfo,
} from "@/lib/net/match";
import { renderShareCard, shareCard } from "@/lib/shareCard";
import { ladderEnabled } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

type Phase = "connecting" | "queue" | "room" | "position" | "countdown" | "live" | "done";
type Mode = "ranked" | "solo" | "room";

const AMRAP_IDLE_MS = 10_000;
const GHOST_AFTER_MS = 9_000;

interface Opp extends PeerInfo {
  isGhost: boolean;
  reps: number;
  noReps: number;
}

export default function PlayClient() {
  const params = useSearchParams();
  const router = useRouter();

  const mode = (params.get("mode") ?? "ranked") as Mode;
  const durationS = mode === "solo" ? Number(params.get("d") ?? 0) : Number(params.get("d") ?? 60);
  const strictness: Strictness = (params.get("s") as Strictness) ?? "ranked";
  const urlCode = params.get("code")?.toUpperCase() ?? "";
  const simulate = params.get("sim") === "1";

  const [me, setMe] = useState<Player | null>(null);
  const [phase, setPhase] = useState<Phase>("connecting");
  const [status, setStatus] = useState("Getting you on the board");
  const [opp, setOpp] = useState<Opp | null>(null);
  const [myReps, setMyReps] = useState(0);
  const [oppReps, setOppReps] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [countdown, setCountdown] = useState(3);
  const [noRep, setNoRep] = useState<{ reason: NoRepReason; key: number } | null>(null);
  const [inPosition, setInPosition] = useState(false);
  const [result, setResult] = useState<{ delta: number; ratingAfter: number; flagged: string | null } | null>(null);
  const [code, setCode] = useState(urlCode);
  const [codeDraft, setCodeDraft] = useState("");
  const [shareState, setShareState] = useState<"idle" | "working" | "done">("idle");
  const [fatal, setFatal] = useState<string | null>(null);

  const matchIdRef = useRef<string>("");
  const channelRef = useRef<RealtimeChannel | null>(null);
  const ghostRef = useRef<GhostRun | null>(null);
  const startPerfRef = useRef(0);
  const timelineRef = useRef<number[]>([]);
  const noRepCountRef = useRef(0);
  const oppCurveRef = useRef<Array<[number, number]>>([]);
  const oppRef = useRef<Opp | null>(null);
  const lastRepAtRef = useRef(0);
  const peerReadyRef = useRef(false);
  const iAmReadyRef = useRef(false);
  const isHostRef = useRef(false);
  const goneRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const hiddenMsRef = useRef(0);

  oppRef.current = opp;

  // ---- identity ----------------------------------------------------------
  useEffect(() => {
    const id = playerId();
    const h = getHandle();
    setMe(cachedPlayer(id, h));
    void syncPlayer(id, h).then(setMe);
  }, []);

  const peer: PeerInfo | null = useMemo(
    () => (me ? { id: me.id, handle: me.handle, rating: me.rating, matches: me.matches } : null),
    [me],
  );

  // ---- wiring a connected 1v1 channel ------------------------------------
  const wireChannel = useCallback((ch: RealtimeChannel, meId: string) => {
    channelRef.current = ch;

    ch.on("broadcast", { event: "state" }, ({ payload }) => {
      const p = payload as { reps: number; noReps: number };
      setOppReps(p.reps);
      oppCurveRef.current.push([performance.now() - startPerfRef.current, p.reps]);
    });

    ch.on("broadcast", { event: "final" }, ({ payload }) => {
      const p = payload as { reps: number; noReps: number };
      setOppReps(p.reps);
      if (oppRef.current) oppRef.current = { ...oppRef.current, reps: p.reps, noReps: p.noReps };
    });

    ch.on("broadcast", { event: "ready" }, ({ payload }) => {
      peerReadyRef.current = (payload as { ready: boolean }).ready;
      maybeStart();
    });

    ch.on("broadcast", { event: "go" }, () => beginCountdown());

    ch.on("presence", { event: "leave" }, () => {
      if (peersIn(ch, meId).length === 0) {
        goneRef.current = true;
        setStatus("Opponent disconnected");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const maybeStart = useCallback(() => {
    if (!isHostRef.current || !channelRef.current) return;
    if (!iAmReadyRef.current || !peerReadyRef.current) return;
    sendGo(channelRef.current, Date.now());
    beginCountdown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const beginCountdown = useCallback(() => {
    setPhase((p) => (p === "countdown" || p === "live" ? p : "countdown"));
  }, []);

  // ---- matchmaking -------------------------------------------------------
  useEffect(() => {
    if (!peer) return;
    let cancelled = false;

    if (mode === "solo") {
      matchIdRef.current = crypto.randomUUID();
      setPhase("position");
      return;
    }

    if (mode === "room") {
      if (!code) {
        setPhase("room");
        return;
      }
      matchIdRef.current = crypto.randomUUID();
      setPhase("room");
      setStatus(`Room ${code} — waiting for someone to join`);

      void (async () => {
        try {
          const { channel } = await joinRoom(code, peer);
          if (cancelled) {
            void channel.unsubscribe();
            return;
          }
          wireChannel(channel, peer.id);

          const check = () => {
            const others = peersIn(channel, peer.id);
            if (others.length > 0) {
              const other = others[0];
              // Same rule as the lobby: the lower id runs the countdown.
              isHostRef.current = peer.id.localeCompare(other.id) < 0;
              setOpp({ ...other, isGhost: false, reps: 0, noReps: 0 });
              setPhase("position");
            }
          };
          channel.on("presence", { event: "sync" }, check);
          channel.on("presence", { event: "join" }, check);
          check();
        } catch (err) {
          if (!cancelled) setFatal((err as Error).message);
        }
      })();
      return;
    }

    // ranked
    setPhase("queue");
    const ac = new AbortController();
    abortRef.current = ac;

    void (async () => {
      try {
        const found: Found = await queueForMatch({
          me: peer,
          durationS,
          ghostAfterMs: GHOST_AFTER_MS,
          onStatus: setStatus,
          signal: ac.signal,
        });
        if (cancelled) return;
        matchIdRef.current = found.matchId;

        if (found.kind === "ghost") {
          ghostRef.current = found.ghost;
          setOpp({
            id: found.ghost.playerId ?? "ghost",
            handle: found.ghost.handle,
            rating: found.ghost.rating,
            matches: 30,
            isGhost: true,
            reps: 0,
            noReps: 0,
          });
        } else {
          isHostRef.current = found.isHost;
          wireChannel(found.channel, peer.id);
          setOpp({ ...found.peer, isGhost: false, reps: 0, noReps: 0 });
        }
        setPhase("position");
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setFatal((err as Error).message);
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
    };
  }, [peer, mode, durationS, code, wireChannel]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
      void channelRef.current?.unsubscribe();
    },
    [],
  );

  // ---- readiness ---------------------------------------------------------
  const handleInPosition = useCallback(
    (ready: boolean) => {
      setInPosition(ready);
      if (phase !== "position") return;
      iAmReadyRef.current = ready;

      if (channelRef.current) {
        sendReady(channelRef.current, ready);
        maybeStart();
      } else if (ready) {
        beginCountdown();
      }
    },
    [phase, maybeStart, beginCountdown],
  );

  // ---- countdown ---------------------------------------------------------
  useEffect(() => {
    if (phase !== "countdown") return;
    setCountdown(3);
    const t = setInterval(() => {
      setCountdown((n) => {
        if (n <= 1) {
          clearInterval(t);
          timelineRef.current = [];
          noRepCountRef.current = 0;
          hiddenMsRef.current = 0;
          oppCurveRef.current = [];
          lastRepAtRef.current = 0;
          startPerfRef.current = performance.now();
          setMyReps(0);
          setOppReps(0);
          setPhase("live");
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [phase]);

  /**
   * Browsers pause requestAnimationFrame in a hidden tab, so the referee stops
   * seeing frames while the clock keeps running — you would come back to a
   * frozen count and no explanation. Hold a wake lock to stop the screen
   * sleeping mid-set, and measure any time spent hidden so the result can say
   * what happened.
   */
  useEffect(() => {
    if (phase !== "live") return;

    type Sentinel = { release: () => Promise<void> };
    const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<Sentinel> } }).wakeLock;
    let lock: Sentinel | null = null;
    let hiddenAt: number | null = document.hidden ? performance.now() : null;

    const acquire = async () => {
      try {
        lock = (await wl?.request("screen")) ?? null;
      } catch {
        /* denied or unsupported — the match still runs */
      }
    };
    void acquire();

    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = performance.now();
      } else {
        if (hiddenAt !== null) hiddenMsRef.current += performance.now() - hiddenAt;
        hiddenAt = null;
        void acquire(); // the lock is dropped automatically when hidden
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (hiddenAt !== null) hiddenMsRef.current += performance.now() - hiddenAt;
      void lock?.release();
    };
  }, [phase]);

  // ---- the match ---------------------------------------------------------
  const finish = useCallback(async () => {
    setPhase("done");
    const ch = channelRef.current;
    if (ch) sendFinal(ch, { reps: timelineRef.current.length, noReps: noRepCountRef.current });

    // Give the other side a moment to report their own total.
    if (ch && !goneRef.current) await new Promise((r) => setTimeout(r, 1500));

    const current = me;
    if (!current) return;

    const o = oppRef.current;
    const ghost = ghostRef.current;
    const oppFinal = ghost
      ? ghost.timeline.filter((t) => t <= (durationS > 0 ? durationS * 1000 : Infinity)).length
      : (o?.reps ?? 0);

    const r = await submitResult({
      matchId: matchIdRef.current,
      mode: mode === "solo" ? "solo" : ghost ? "ghost" : mode === "room" ? "friendly" : "ranked",
      durationS,
      me: current,
      myReps: timelineRef.current.length,
      myNoReps: noRepCountRef.current,
      timeline: timelineRef.current,
      opponent: o
        ? {
            id: ghost ? null : o.id,
            rating: o.rating,
            matches: o.matches,
            reps: oppFinal,
            noReps: o.noReps,
            handle: o.handle,
          }
        : undefined,
      ghostOf: ghost?.playerId ?? null,
    });

    setResult({ delta: r.delta, ratingAfter: r.ratingAfter, flagged: r.flagged });
    setMe({ ...current, rating: r.ratingAfter, matches: current.matches + (mode === "solo" ? 0 : 1) });
  }, [me, mode, durationS]);

  useEffect(() => {
    if (phase !== "live") return;

    const tick = setInterval(() => {
      const now = performance.now();
      const el = now - startPerfRef.current;
      setElapsed(el);

      // Ghosts are a recording: their count is however many of their reps
      // would have landed by now.
      const g = ghostRef.current;
      if (g) setOppReps(g.timeline.filter((t) => t <= el).length);

      if (durationS > 0) {
        if (el >= durationS * 1000) void finish();
      } else {
        const since = lastRepAtRef.current ? now - lastRepAtRef.current : el;
        if ((lastRepAtRef.current && since > AMRAP_IDLE_MS) || (!lastRepAtRef.current && el > 25_000)) void finish();
      }
    }, 100);

    const beat = setInterval(() => {
      if (channelRef.current) sendState(channelRef.current, { reps: timelineRef.current.length, noReps: noRepCountRef.current });
    }, 900);

    return () => {
      clearInterval(tick);
      clearInterval(beat);
    };
  }, [phase, durationS, finish]);

  const onRep = useCallback((r: RepEvent) => {
    const t = Math.round(r.tMs - startPerfRef.current);
    timelineRef.current.push(t);
    lastRepAtRef.current = r.tMs;
    setMyReps(timelineRef.current.length);
    if (channelRef.current) sendState(channelRef.current, { reps: timelineRef.current.length, noReps: noRepCountRef.current });
  }, []);

  const onNoRep = useCallback((n: NoRepEvent) => {
    noRepCountRef.current += 1;
    setNoRep({ reason: n.reason, key: Date.now() });
    setTimeout(() => setNoRep((c) => (c && Date.now() - c.key > 1100 ? null : c)), 1200);
  }, []);

  // ---- share -------------------------------------------------------------
  const doShare = async () => {
    if (!me) return;
    setShareState("working");
    try {
      const g = ghostRef.current;
      const blob = await renderShareCard({
        mode: mode === "solo" ? "MAX SET" : mode === "room" ? "FRIENDLY" : "RANKED MATCH",
        durationS,
        me: {
          handle: me.handle,
          reps: myReps,
          noReps: noRepCountRef.current,
          rating: result?.ratingAfter ?? me.rating,
          delta: result?.delta ?? 0,
          timeline: timelineRef.current,
        },
        opp: opp
          ? {
              handle: opp.handle,
              reps: oppReps,
              rating: opp.rating,
              isGhost: opp.isGhost,
              curve: g ? g.timeline.map((t, i) => [t, i + 1] as [number, number]) : oppCurveRef.current,
            }
          : null,
      });
      await shareCard(blob, `pushup-gg-${Date.now()}.png`);
      setShareState("done");
    } catch {
      setShareState("idle");
    }
  };

  // ---- render ------------------------------------------------------------
  const clock =
    durationS > 0
      ? fmt(Math.max(0, durationS * 1000 - elapsed))
      : fmt(elapsed);

  const meSide: Side = { handle: me?.handle ?? "YOU", rating: me?.rating ?? 1000, reps: myReps };
  const oppSide: Side | null = opp
    ? { handle: opp.handle, rating: opp.rating, reps: oppReps, isGhost: opp.isGhost }
    : null;

  if (fatal) {
    return (
      <Shell>
        <h1 className="display text-3xl">Couldn&apos;t start the match</h1>
        <p className="mt-2 max-w-md text-muted">{fatal}</p>
        <Link href="/" className="display mt-6 inline-block rounded-lg bg-you px-5 py-2 text-ink">
          Back
        </Link>
      </Shell>
    );
  }

  if (mode === "room" && !code) {
    return <RoomPicker draft={codeDraft} setDraft={setCodeDraft} onCreate={(c) => { setCode(c); router.replace(`/play?mode=room&code=${c}`); }} />;
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black">
      <CameraStage
        simulate={simulate}
        strictness={strictness}
        armed={phase === "live"}
        onRep={onRep}
        onNoRep={onNoRep}
        onInPosition={handleInPosition}
      />

      {(phase === "live" || phase === "countdown") && (
        <MatchHud
          me={meSide}
          opp={oppSide}
          clock={clock}
          noRep={noRep}
          subtitle={mode === "solo" ? "MAX SET" : mode === "room" ? "FRIENDLY" : undefined}
        />
      )}

      {phase !== "live" && phase !== "done" && (
        <Overlay>
          {phase === "countdown" ? (
            <p key={countdown} className="display pop text-[9rem] leading-none text-you">
              {countdown}
            </p>
          ) : phase === "position" ? (
            <>
              <p className="display text-4xl">{inPosition ? "Hold it" : "Get into position"}</p>
              <p className="mt-3 max-w-sm text-muted">
                {inPosition
                  ? channelRef.current
                    ? "Waiting for your opponent to set up."
                    : "Starting."
                  : "Camera side-on, whole body in frame, arms locked out at the top. The match starts on its own."}
              </p>
              <div className="mt-6 h-1.5 w-48 overflow-hidden rounded-full bg-line">
                <div className={`h-full bg-you transition-all duration-700 ${inPosition ? "w-full" : "w-0"}`} />
              </div>
            </>
          ) : phase === "room" ? (
            <>
              <p className="display text-sm tracking-[0.25em] text-muted">ROOM CODE</p>
              <p className="display mt-1 text-6xl tracking-[0.15em] text-you">{code}</p>
              <p className="mt-4 max-w-sm text-muted">{status}</p>
              <button
                onClick={() => void navigator.clipboard?.writeText(window.location.href)}
                className="display mt-5 rounded-lg border border-line px-4 py-2 text-sm transition hover:border-white/30"
              >
                Copy invite link
              </button>
            </>
          ) : (
            <>
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-you" />
              <p className="display mt-5 text-3xl">{status}</p>
              {phase === "queue" && (
                <p className="mt-2 max-w-sm text-muted">
                  If nobody turns up in a few seconds you&apos;ll race a ghost — a real set someone
                  already filmed, replayed against your clock.
                </p>
              )}
            </>
          )}
          <Link href="/" className="display mt-10 text-sm text-muted transition hover:text-text">
            Leave
          </Link>
        </Overlay>
      )}

      {phase === "done" && (
        <Done
          me={meSide}
          opp={oppSide}
          mode={mode}
          durationS={durationS}
          noReps={noRepCountRef.current}
          hiddenMs={hiddenMsRef.current}
          result={result}
          onShare={doShare}
          shareState={shareState}
        />
      )}
    </main>
  );
}

function fmt(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="grid min-h-dvh place-items-center px-6 text-center">{children}</main>;
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/80 px-6 text-center backdrop-blur-sm">
      <div>{children}</div>
    </div>
  );
}

function RoomPicker({
  draft,
  setDraft,
  onCreate,
}: {
  draft: string;
  setDraft: (s: string) => void;
  onCreate: (code: string) => void;
}) {
  return (
    <Shell>
      <div className="w-full max-w-sm">
        <h1 className="display text-4xl">Private room</h1>
        <p className="mt-2 text-muted">Two cameras, one bar. Share the code or the link.</p>
        <button
          onClick={() => onCreate(newRoomCode())}
          className="display mt-7 w-full rounded-lg bg-you py-3 text-lg text-ink transition hover:brightness-110"
        >
          Create a room
        </button>
        <div className="my-5 flex items-center gap-3 text-xs text-muted">
          <span className="h-px flex-1 bg-line" /> OR <span className="h-px flex-1 bg-line" />
        </div>
        <div className="flex gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value.toUpperCase().slice(0, 6))}
            placeholder="CODE"
            className="display w-full rounded-lg border border-line bg-ink px-4 py-3 text-center text-xl tracking-[0.2em] outline-none focus:border-you"
          />
          <button
            disabled={draft.length < 4}
            onClick={() => onCreate(draft)}
            className="display rounded-lg border border-line px-5 text-sm disabled:opacity-40"
          >
            Join
          </button>
        </div>
        <Link href="/" className="display mt-8 inline-block text-sm text-muted hover:text-text">
          Back
        </Link>
      </div>
    </Shell>
  );
}

function Done({
  me,
  opp,
  mode,
  durationS,
  noReps,
  hiddenMs,
  result,
  onShare,
  shareState,
}: {
  me: Side;
  opp: Side | null;
  mode: Mode;
  durationS: number;
  noReps: number;
  hiddenMs: number;
  result: { delta: number; ratingAfter: number; flagged: string | null } | null;
  onShare: () => void;
  shareState: "idle" | "working" | "done";
}) {
  const won = opp ? me.reps > opp.reps : true;
  const drew = opp ? me.reps === opp.reps : false;
  const verdict = mode === "solo" ? "SET COMPLETE" : drew ? "DRAW" : won ? "WIN" : "LOSS";
  const colour = mode === "solo" ? "text-gold" : drew ? "text-gold" : won ? "text-you" : "text-them";

  return (
    <div className="absolute inset-0 z-40 overflow-y-auto bg-ink/95 px-6 py-10 backdrop-blur">
      <div className="rise mx-auto max-w-md text-center">
        <p className={`display text-6xl ${colour}`}>{verdict}</p>

        <div className="panel mt-7 flex items-center justify-between gap-4 p-5">
          <div className="flex-1">
            <p className="display truncate text-sm text-muted">{me.handle}</p>
            <p className="display tabular text-5xl text-you">{me.reps}</p>
          </div>
          <span className="display text-sm text-muted">VS</span>
          <div className="flex-1 text-right">
            <p className="display truncate text-sm text-muted">{opp?.handle ?? "—"}</p>
            <p className="display tabular text-5xl text-them">{opp?.reps ?? 0}</p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-line bg-line">
          <Stat label="No reps" value={String(noReps)} tone={noReps > 0 ? "text-them" : undefined} />
          <Stat label={durationS > 0 ? "Window" : "Mode"} value={durationS > 0 ? `${durationS}s` : "AMRAP"} />
          <Stat
            label="Rating"
            value={result ? `${result.delta >= 0 ? "+" : ""}${result.delta}` : "—"}
            tone={result && result.delta >= 0 ? "text-you" : "text-them"}
          />
        </div>

        {result && (
          <div className="mt-4 flex items-center justify-center gap-3">
            <RankBadge rating={result.ratingAfter} />
            <span className="display tabular text-xl">{result.ratingAfter}</span>
          </div>
        )}

        {result?.flagged && (
          <p className="mt-4 rounded-lg border border-them/40 bg-them/10 px-4 py-3 text-sm text-them">
            This set didn&apos;t reach the ladder — it failed the plausibility check
            ({result.flagged.replace(/-/g, " ")}). Nothing was recorded.
          </p>
        )}
        {hiddenMs > 1500 && (
          <p className="mt-4 rounded-lg border border-gold/40 bg-gold/10 px-4 py-3 text-sm text-gold">
            This tab was in the background for {(hiddenMs / 1000).toFixed(0)}s. Browsers stop
            sending camera frames to a hidden tab, so nothing was counted during that time.
          </p>
        )}
        {!ladderEnabled && (
          <p className="mt-4 text-sm text-muted">Ladder offline — this result was kept on this device only.</p>
        )}

        <button
          onClick={onShare}
          disabled={shareState === "working"}
          className="display mt-7 w-full rounded-lg bg-you py-3 text-lg text-ink transition hover:brightness-110 disabled:opacity-50"
        >
          {shareState === "working" ? "Drawing…" : shareState === "done" ? "Saved ✓" : "Save the result card"}
        </button>
        <div className="mt-3 flex gap-3">
          <Link
            href={`/play?mode=${mode}${durationS ? `&d=${durationS}` : "&d=0"}`}
            className="display flex-1 rounded-lg border border-line py-3 transition hover:border-white/30"
            onClick={() => setTimeout(() => window.location.reload(), 0)}
          >
            Again
          </Link>
          <Link href="/leaderboard" className="display flex-1 rounded-lg border border-line py-3 transition hover:border-white/30">
            Ladder
          </Link>
        </div>
        <Link href="/" className="display mt-6 inline-block text-sm text-muted hover:text-text">
          Home
        </Link>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="bg-ink-2 px-2 py-4">
      <p className="display text-[10px] tracking-[0.15em] text-muted">{label.toUpperCase()}</p>
      <p className={`display tabular mt-1 text-2xl ${tone ?? ""}`}>{value}</p>
    </div>
  );
}

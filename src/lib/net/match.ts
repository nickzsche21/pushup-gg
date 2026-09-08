"use client";

import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "../supabase/client";

export interface PeerInfo {
  id: string;
  handle: string;
  rating: number;
  /** Their match count — the other side needs it to pick the right K-factor. */
  matches: number;
}

export interface GhostRun {
  id: string | null;
  playerId: string | null;
  handle: string;
  rating: number;
  durationS: number;
  reps: number;
  timeline: number[];
}

export type Found =
  | { kind: "human"; matchId: string; isHost: boolean; peer: PeerInfo; channel: RealtimeChannel }
  | { kind: "ghost"; matchId: string; ghost: GhostRun };

export interface LiveState {
  reps: number;
  noReps: number;
}

const lobbyName = (d: number) => `pug-lobby-v1-${d}`;
const matchName = (id: string) => `pug-match-v1-${id}`;
export const roomName = (code: string) => `pug-room-v1-${code.toUpperCase()}`;

/**
 * Hands back a channel for `topic` that has definitely not been subscribed yet.
 *
 * supabase-js caches channels by topic, and handlers cannot be attached to one
 * that is already subscribed. Without this, re-entering a lobby you just left —
 * which React does on every dev double-mount, and a player does by backing out
 * and queueing again — throws "cannot add callbacks after subscribe()".
 */
async function freshChannel(
  sb: SupabaseClient,
  topic: string,
  config: Parameters<SupabaseClient["channel"]>[1],
): Promise<RealtimeChannel> {
  const existing = sb.getChannels().filter((c) => c.topic === topic || c.topic === `realtime:${topic}`);
  for (const c of existing) await sb.removeChannel(c);
  return sb.channel(topic, config);
}

function waitForSubscribe(ch: RealtimeChannel): Promise<void> {
  return new Promise((resolve, reject) => {
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") resolve();
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(status));
    });
  });
}

/**
 * Sits in the lobby looking for a live opponent, and falls back to a ghost.
 *
 * Pairing is decided without a server: everyone waiting publishes their rating
 * through presence, and of any two candidates the lower player id is the one
 * allowed to send the offer. That single rule is what stops both sides
 * proposing to each other simultaneously and pairing into two dead matches.
 */
export async function queueForMatch(opts: {
  me: PeerInfo;
  durationS: number;
  ghostAfterMs: number;
  onStatus?: (s: string) => void;
  signal?: AbortSignal;
}): Promise<Found> {
  const { me, durationS, ghostAfterMs, onStatus, signal } = opts;
  const sb = supabase();

  if (!sb) {
    onStatus?.("No ladder configured — racing a ghost");
    return { kind: "ghost", matchId: crypto.randomUUID(), ghost: await pickGhost(me, durationS) };
  }

  const lobby = await freshChannel(sb, lobbyName(durationS), {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  });

  return new Promise<Found>((resolve, reject) => {
    let settled = false;
    let claimed: string | null = null;
    let ghostTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = async () => {
      if (ghostTimer) clearTimeout(ghostTimer);
      try {
        await lobby.untrack();
      } catch {
        /* channel may already be gone */
      }
      await sb.removeChannel(lobby);
    };

    const finish = async (make: () => Promise<Found>) => {
      if (settled) return;
      settled = true;
      try {
        const found = await make();
        await cleanup();
        resolve(found);
      } catch (err) {
        await cleanup();
        reject(err);
      }
    };

    signal?.addEventListener("abort", () => {
      if (settled) return;
      settled = true;
      void cleanup();
      reject(new DOMException("cancelled", "AbortError"));
    });

    const consider = () => {
      if (settled || claimed) return;
      const state = lobby.presenceState<PeerInfo>();

      const others = Object.values(state)
        .flat()
        .filter((p) => p && p.id && p.id !== me.id);
      if (others.length === 0) return;

      // Closest rating first; ties broken by id so both sides agree.
      others.sort((a, b) => Math.abs(a.rating - me.rating) - Math.abs(b.rating - me.rating) || a.id.localeCompare(b.id));
      const target = others[0];

      // Only the lower id proposes. The other side just waits for the offer.
      if (me.id.localeCompare(target.id) >= 0) return;

      claimed = crypto.randomUUID();
      onStatus?.(`Found ${target.handle} — connecting`);
      void lobby.send({
        type: "broadcast",
        event: "offer",
        payload: { matchId: claimed, from: me, to: target.id },
      });
    };

    lobby.on("presence", { event: "sync" }, consider);
    lobby.on("presence", { event: "join" }, consider);

    lobby.on("broadcast", { event: "offer" }, ({ payload }) => {
      if (settled || claimed) return;
      const p = payload as { matchId: string; from: PeerInfo; to: string };
      if (p.to !== me.id) return;

      claimed = p.matchId;
      onStatus?.(`Found ${p.from.handle} — connecting`);
      void lobby.send({ type: "broadcast", event: "accept", payload: { matchId: p.matchId, from: me, to: p.from.id } });
      void finish(async () => ({
        kind: "human",
        matchId: p.matchId,
        isHost: false,
        peer: p.from,
        channel: await joinMatch(p.matchId, me),
      }));
    });

    lobby.on("broadcast", { event: "accept" }, ({ payload }) => {
      const p = payload as { matchId: string; from: PeerInfo; to: string };
      if (settled || p.to !== me.id || p.matchId !== claimed) return;
      void finish(async () => ({
        kind: "human",
        matchId: p.matchId,
        isHost: true,
        peer: p.from,
        channel: await joinMatch(p.matchId, me),
      }));
    });

    void (async () => {
      try {
        await waitForSubscribe(lobby);
        await lobby.track(me);
        onStatus?.("Searching for an opponent");
        consider();

        ghostTimer = setTimeout(() => {
          void finish(async () => ({
            kind: "ghost",
            matchId: crypto.randomUUID(),
            ghost: await pickGhost(me, durationS),
          }));
        }, ghostAfterMs);
      } catch (err) {
        if (settled) return;
        settled = true;
        reject(err);
      }
    })();
  });
}

async function joinMatch(matchId: string, me: PeerInfo): Promise<RealtimeChannel> {
  const sb = supabase();
  if (!sb) throw new Error("realtime unavailable");
  const ch = await freshChannel(sb, matchName(matchId), {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  });
  await waitForSubscribe(ch);
  await ch.track(me);
  return ch;
}

/** Private room: two people type the same code. Lower id hosts. */
export async function joinRoom(code: string, me: PeerInfo): Promise<{ channel: RealtimeChannel }> {
  const sb = supabase();
  if (!sb) throw new Error("Private rooms need the realtime service configured.");
  const ch = await freshChannel(sb, roomName(code), {
    config: { presence: { key: me.id }, broadcast: { self: false } },
  });
  await waitForSubscribe(ch);
  await ch.track(me);
  return { channel: ch };
}

export function peersIn(ch: RealtimeChannel, meId: string): PeerInfo[] {
  const state = ch.presenceState<PeerInfo>();
  return Object.values(state)
    .flat()
    .filter((p) => p && p.id && p.id !== meId)
    .map((p) => ({ id: p.id, handle: p.handle, rating: p.rating, matches: p.matches ?? 0 }));
}

export function sendState(ch: RealtimeChannel, s: LiveState) {
  void ch.send({ type: "broadcast", event: "state", payload: s });
}

export function sendGo(ch: RealtimeChannel, at: number) {
  void ch.send({ type: "broadcast", event: "go", payload: { at } });
}

export function sendReady(ch: RealtimeChannel, ready: boolean) {
  void ch.send({ type: "broadcast", event: "ready", payload: { ready } });
}

/** Six characters, no vowels and no 0/O/1/I — these get read aloud. */
export function newRoomCode() {
  const alphabet = "BCDFGHJKLMNPQRSTVWXYZ23456789";
  return Array.from({ length: 6 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("");
}

export function sendFinal(ch: RealtimeChannel, s: LiveState) {
  void ch.send({ type: "broadcast", event: "final", payload: s });
}

const SYNTHETIC_HANDLES = ["PACEMAKER", "THE_METRONOME", "RIVAL_01", "BENCHMARK"];

/**
 * A ghost is a real past set replayed against you. When the table has nothing
 * suitable yet — day one, or an unusual duration — we synthesise a pacer at a
 * rate implied by the rating, so the mode still works on an empty database.
 */
export async function pickGhost(me: PeerInfo, durationS: number): Promise<GhostRun> {
  const sb = supabase();
  if (sb) {
    const { data } = await sb.rpc("pug_pick_ghost", {
      p_rating: me.rating,
      p_duration_s: durationS,
      p_exclude: me.id,
    });
    const g = Array.isArray(data) ? data[0] : data;
    if (g && Array.isArray(g.timeline) && g.timeline.length > 0) {
      return {
        id: g.id,
        playerId: g.player_id,
        handle: g.handle,
        rating: g.rating,
        durationS: g.duration_s,
        reps: g.reps,
        timeline: g.timeline,
      };
    }
  }
  return syntheticGhost(me.rating, durationS);
}

export function syntheticGhost(rating: number, durationS: number): GhostRun {
  // Roughly 18 reps/min at 1000, scaling with rating — then the tail-off a
  // real set has, because a pacer with metronome timing is demoralising in a
  // way that teaches nothing.
  const target = Math.max(6, Math.round((durationS / 60) * (14 + (rating - 800) / 45)));
  const timeline: number[] = [];
  let t = 800 + Math.random() * 600;
  for (let i = 0; i < target; i++) {
    const fatigue = 1 + (i / target) * 0.7;
    const gap = ((durationS * 1000) / target) * fatigue * (0.88 + Math.random() * 0.24);
    t += gap;
    if (durationS > 0 && t > durationS * 1000) break;
    timeline.push(Math.round(t));
  }
  return {
    id: null,
    playerId: null,
    handle: SYNTHETIC_HANDLES[Math.floor(Math.random() * SYNTHETIC_HANDLES.length)],
    rating: Math.max(400, rating + Math.round((Math.random() - 0.5) * 120)),
    durationS,
    reps: timeline.length,
    timeline,
  };
}

"use client";

import { computeElo, START_RATING } from "./elo";
import { supabase } from "./supabase/client";

export interface Player {
  id: string;
  handle: string;
  rating: number;
  peak_rating: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  total_reps: number;
  best_set: number;
  best_sprint: number;
}

export function offlinePlayer(id: string, handle: string): Player {
  return {
    id,
    handle,
    rating: START_RATING,
    peak_rating: START_RATING,
    matches: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    total_reps: 0,
    best_set: 0,
    best_sprint: 0,
  };
}

const LOCAL_KEY = "pug.localPlayer";

/** Mirrors the ladder row locally so the app opens instantly and still works offline. */
export function cachedPlayer(id: string, handle: string): Player {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Player;
      if (p.id === id) return { ...p, handle };
    }
  } catch {
    /* corrupt cache is not worth crashing over */
  }
  return offlinePlayer(id, handle);
}

export function cachePlayer(p: Player) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(p));
  } catch {
    /* private browsing */
  }
}

export async function syncPlayer(id: string, handle: string): Promise<Player> {
  const sb = supabase();
  if (!sb) return cachedPlayer(id, handle);

  const { data, error } = await sb.rpc("pug_upsert_player", { p_id: id, p_handle: handle });
  const row = (Array.isArray(data) ? data[0] : data) as Player | null;
  if (error || !row) return cachedPlayer(id, handle);

  cachePlayer(row);
  return row;
}

export interface SubmitArgs {
  matchId: string;
  mode: "ranked" | "ghost" | "friendly" | "solo";
  durationS: number;
  me: Player;
  myReps: number;
  myNoReps: number;
  timeline: number[];
  opponent?: { id: string | null; rating: number; matches: number; reps: number; noReps: number; handle: string };
  ghostOf?: string | null;
}

export interface SubmitResult {
  applied: boolean;
  flagged: string | null;
  delta: number;
  ratingAfter: number;
}

/**
 * Sends a finished match to the ladder.
 *
 * Both players submit the same match id; the database applies whichever
 * arrives first and hands the second an identical row, so the two clients
 * always agree on the outcome without needing to elect a reporter.
 */
export async function submitResult(a: SubmitArgs): Promise<SubmitResult> {
  const sb = supabase();
  const ghost = a.mode === "ghost";
  const opp = a.opponent;

  const { aDelta, bDelta } =
    a.mode === "solo" || !opp
      ? { aDelta: 0, bDelta: 0 }
      : computeElo(
          { rating: a.me.rating, matches: a.me.matches },
          { rating: opp.rating, matches: opp.matches },
          a.myReps,
          opp.reps,
          { ghost },
        );

  if (!sb) {
    // Offline: keep the local mirror moving so progression still feels real.
    const next = {
      ...a.me,
      rating: Math.max(100, a.me.rating + aDelta),
      matches: a.me.matches + (a.mode === "solo" ? 0 : 1),
      total_reps: a.me.total_reps + a.myReps,
      best_set: a.durationS === 0 ? Math.max(a.me.best_set, a.myReps) : a.me.best_set,
      best_sprint: a.durationS === 60 ? Math.max(a.me.best_sprint, a.myReps) : a.me.best_sprint,
    };
    next.peak_rating = Math.max(next.peak_rating, next.rating);
    cachePlayer(next);
    return { applied: true, flagged: null, delta: aDelta, ratingAfter: next.rating };
  }

  const { data, error } = await sb.rpc("pug_apply_result", {
    p_match_id: a.matchId,
    p_mode: a.mode,
    p_duration_s: a.durationS,
    p_a_id: a.me.id,
    p_b_id: opp?.id ?? null,
    p_a_reps: a.myReps,
    p_b_reps: opp?.reps ?? 0,
    p_a_no_reps: a.myNoReps,
    p_b_no_reps: opp?.noReps ?? 0,
    p_a_delta: aDelta,
    p_b_delta: bDelta,
    p_ghost_of: a.ghostOf ?? null,
    p_ghost_handle: ghost ? (opp?.handle ?? null) : null,
    p_timeline: a.timeline,
  });

  if (error) return { applied: false, flagged: null, delta: 0, ratingAfter: a.me.rating };

  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        a_id: string;
        a_delta: number;
        b_delta: number;
        a_rating_after: number | null;
        b_rating_after: number | null;
        flagged: string | null;
      }
    | null;
  if (!row) return { applied: false, flagged: null, delta: 0, ratingAfter: a.me.rating };

  // Both players submit the same match with the sides swapped, and the database
  // keeps whichever arrived first. If that was the other player, this row is
  // written from their point of view — read our numbers off the B columns, or
  // we would show the loser the winner's rating change.
  const iAmA = row.a_id === a.me.id;
  const myDelta = (iAmA ? row.a_delta : row.b_delta) ?? 0;
  const ratingAfter = (iAmA ? row.a_rating_after : row.b_rating_after) ?? a.me.rating;
  cachePlayer({ ...a.me, rating: ratingAfter, peak_rating: Math.max(a.me.peak_rating, ratingAfter) });

  return {
    applied: !row.flagged,
    flagged: row.flagged,
    delta: myDelta,
    ratingAfter,
  };
}

export async function leaderboard(limit = 50): Promise<Player[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data } = await sb
    .from("pug_players")
    .select("*")
    .gt("matches", 0)
    .order("rating", { ascending: false })
    .limit(limit);
  return (data ?? []) as Player[];
}

export async function recordsBoard(limit = 25): Promise<Player[]> {
  const sb = supabase();
  if (!sb) return [];
  const { data } = await sb
    .from("pug_players")
    .select("*")
    .gt("best_set", 0)
    .order("best_set", { ascending: false })
    .limit(limit);
  return (data ?? []) as Player[];
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RankBadge } from "@/components/RankBadge";
import { leaderboard, variationRecords, type Player, type VariationRecord } from "@/lib/api";
import { VARIATIONS, variation as varyOf } from "@/lib/pose/variations";
import { playerId } from "@/lib/identity";
import { ladderEnabled } from "@/lib/supabase/client";

type Board = "rating" | "records";

interface Row {
  id: string;
  handle: string;
  rating: number;
  primary: number;
  sub: string;
}

export default function LeaderboardPage() {
  const [board, setBoard] = useState<Board>("rating");
  const [vary, setVary] = useState("standard");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [meId, setMeId] = useState("");

  useEffect(() => setMeId(playerId()), []);

  useEffect(() => {
    setRows(null);
    if (board === "rating") {
      void leaderboard(50).then((ps: Player[]) =>
        setRows(
          ps.map((p) => ({
            id: p.id,
            handle: p.handle,
            rating: p.rating,
            primary: p.rating,
            sub: `${p.wins}W · ${p.losses}L · ${p.total_reps} reps`,
          })),
        ),
      );
    } else {
      void variationRecords(vary, 50).then((rs: VariationRecord[]) =>
        setRows(
          rs.map((r) => ({
            id: r.player_id,
            handle: r.handle,
            rating: r.rating,
            primary: r.best,
            sub: `${varyOf(vary).name.toLowerCase()} push-ups, one set`,
          })),
        ),
      );
    }
  }, [board, vary]);

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-24 pt-8">
      <header className="flex items-center justify-between">
        <Link href="/" className="display text-xl">
          PUSHUP<span className="text-you">.GG</span>
        </Link>
        <Link href="/play?mode=ranked&d=60" className="display rounded-lg bg-you px-4 py-1.5 text-sm text-ink">
          Play
        </Link>
      </header>

      <h1 className="display mt-10 text-4xl">The ladder</h1>

      <div className="mt-5 inline-flex gap-1 rounded-lg border border-line p-1">
        {(["rating", "records"] as const).map((b) => (
          <button
            key={b}
            onClick={() => setBoard(b)}
            className={`display rounded-md px-4 py-1.5 text-sm transition ${
              board === b ? "bg-panel text-text" : "text-muted hover:text-text"
            }`}
          >
            {b === "rating" ? "Rating" : "Biggest set"}
          </button>
        ))}
      </div>

      {board === "records" && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {VARIATIONS.map((v) => (
            <button
              key={v.id}
              onClick={() => setVary(v.id)}
              className={`display rounded-md border px-3 py-1 text-xs transition ${
                v.id === vary ? "border-you/60 bg-you/10 text-you" : "border-line text-muted hover:text-text"
              }`}
            >
              {v.name}
            </button>
          ))}
        </div>
      )}

      {!ladderEnabled ? (
        <Empty>The ladder isn&apos;t configured on this deployment. Solo play still works.</Empty>
      ) : rows === null ? (
        <div className="mt-8 space-y-2">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-line/30" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty>
          {board === "rating"
            ? "Nobody has finished a match yet. First win takes the top."
            : `No ${varyOf(vary).name.toLowerCase()} sets recorded yet. First one takes the record.`}
        </Empty>
      ) : (
        <ol className="mt-8 space-y-1.5">
          {rows.map((p, i) => {
            const mine = p.id === meId;
            return (
              <li
                key={p.id}
                className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${
                  mine ? "border-you/50 bg-you/5" : "border-line bg-ink-2"
                }`}
              >
                <span className="display tabular w-8 text-lg text-muted">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="display truncate text-lg">
                    {p.handle}
                    {mine && <span className="ml-2 text-xs text-you">you</span>}
                  </p>
                  <p className="tabular text-xs text-muted">{p.sub}</p>
                </div>
                <RankBadge rating={p.rating} size="sm" />
                <span className="display tabular w-16 text-right text-xl">{p.primary}</span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-8 text-sm leading-relaxed text-muted">
        Ratings start at 1000 and move on an Elo curve weighted by margin — a 21–3 win moves you
        further than a 21–20 one. Only standard push-ups move a rating, so the ladder compares like
        with like; every other variation gets its own records board. Sets that fail the
        plausibility floor never reach this page.
      </p>
    </main>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="panel mt-8 p-8 text-center text-muted">
      <p>{children}</p>
      <Link href="/play?mode=ranked&d=60" className="display mt-4 inline-block text-you">
        Start a match →
      </Link>
    </div>
  );
}

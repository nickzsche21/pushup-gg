"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { RankMeter } from "@/components/RankBadge";
import { cachedPlayer, syncPlayer, type Player } from "@/lib/api";
import { handle as getHandle, playerId, setHandle } from "@/lib/identity";
import { ladderEnabled } from "@/lib/supabase/client";

const MODES = [
  {
    href: "/set",
    kicker: "Log a set",
    title: "Whenever, wherever",
    body: "No target, no countdown, no screens between sets. Starts when you get into a plank, stops ten seconds after your last rep, adds to today's total.",
    accent: "var(--color-you)",
  },
  {
    href: "/play?mode=ranked&d=60",
    kicker: "Ranked",
    title: "1v1 · 60 seconds",
    body: "Queued against the closest rating online. No one waiting? You race a ghost — a real set someone already filmed.",
    accent: "#9be36a",
  },
  {
    href: "/train",
    kicker: "Training",
    title: "Actually get better",
    body: "Sets prescribed against your tested max, moving every week. Because a fixed forty a day stops working almost immediately.",
    accent: "#6aa8ff",
  },
  {
    href: "/play?mode=solo&d=0",
    kicker: "Max set",
    title: "To failure",
    body: "No clock. Ends ten seconds after your last good rep. This is the number that goes on the records board.",
    accent: "var(--color-gold)",
  },
  {
    href: "/play?mode=room",
    kicker: "Private room",
    title: "Someone you know",
    body: "Share a six-character code. Two phones, two cameras, one bar between you.",
    accent: "var(--color-them)",
  },
];

const GATES = [
  ["Depth", "Elbows past 95°. A rep you stop short on is announced as NO REP, not quietly dropped."],
  ["Lockout", "Arms back past 155° at the top. Half-way up is half a rep, which is none."],
  ["Body line", "Shoulder–hip–ankle held above 152°. Sagging or piking voids the rep."],
  ["Tempo", "Nothing under 380ms. Bouncing off the floor is not a push-up."],
  ["Elbow flare", "Upper arm against the torso, measured at the bottom. Winged elbows are logged and coached, and void the rep under strict rules."],
  ["Lowering speed", "Each rep is split into the way down and the way up. The descent is where the strength is, and it is the half everyone skips."],
];

export default function Home() {
  const [player, setPlayer] = useState<Player | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const id = playerId();
    const h = getHandle();
    setPlayer(cachedPlayer(id, h));
    void syncPlayer(id, h).then(setPlayer);
  }, []);

  const save = async () => {
    const clean = draft.trim().slice(0, 18);
    setEditing(false);
    if (!clean || !player) return;
    setHandle(clean);
    setPlayer(await syncPlayer(player.id, clean));
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-5 pb-24 pt-8 sm:pt-12">
      <header className="flex items-center justify-between">
        <span className="display text-xl tracking-tight">
          PUSHUP<span className="text-you">.GG</span>
        </span>
        <nav className="flex items-center gap-5">
          <Link href="/train" className="display text-sm text-muted transition hover:text-text">
            Training
          </Link>
          <Link href="/leaderboard" className="display text-sm text-muted transition hover:text-text">
            Ladder →
          </Link>
        </nav>
      </header>

      <section className="mt-14 sm:mt-20">
        <h1 className="display text-5xl leading-[0.92] sm:text-7xl">
          Ranked 1v1
          <br />
          <span className="text-you">push-ups.</span>
        </h1>
        <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
          Your webcam is the referee. It watches your elbows, your hips and your tempo, and it
          throws out the reps that don&apos;t count — while someone else&apos;s camera does the same to
          them, live, on the same bar.
        </p>
      </section>

      <section className="mt-10 flex flex-wrap gap-3">
        <Link
          href="/set"
          className="display flex-1 rounded-xl bg-you px-6 py-4 text-center text-xl text-ink transition hover:brightness-110"
        >
          Log a set
        </Link>
        <Link
          href="/play?mode=ranked&d=60"
          className="display flex-1 rounded-xl border border-line px-6 py-4 text-center text-xl transition hover:border-white/30"
        >
          Play ranked
        </Link>
      </section>

      <section className="panel mt-4 p-5">
        {player ? (
          <div className="flex flex-wrap items-center justify-between gap-5">
            <div className="min-w-[13rem] flex-1">
              {editing ? (
                <div className="flex gap-2">
                  <input
                    autoFocus
                    value={draft}
                    maxLength={18}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && void save()}
                    className="display w-full rounded-md border border-line bg-ink px-3 py-1.5 text-lg outline-none focus:border-you"
                  />
                  <button onClick={() => void save()} className="display rounded-md bg-you px-4 text-sm text-ink">
                    Save
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setDraft(player.handle);
                    setEditing(true);
                  }}
                  className="display text-left text-2xl transition hover:text-you"
                  title="Change your handle"
                >
                  {player.handle}
                  <span className="ml-2 align-middle text-xs text-muted">edit</span>
                </button>
              )}
              <p className="tabular mt-1 text-sm text-muted">
                {player.matches > 0
                  ? `${player.wins}W · ${player.losses}L · ${player.total_reps} reps counted`
                  : "Unranked — five matches to place"}
              </p>
            </div>
            <div className="w-full sm:w-64">
              <RankMeter rating={player.rating} />
            </div>
          </div>
        ) : (
          <div className="h-20 animate-pulse rounded-lg bg-line/40" />
        )}
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        {MODES.map((m) => (
          <Link
            key={m.href}
            href={m.href}
            className="panel group relative overflow-hidden p-5 transition hover:border-white/25"
          >
            <span className="display text-xs tracking-[0.18em]" style={{ color: m.accent }}>
              {m.kicker}
            </span>
            <h2 className="display mt-1 text-2xl">{m.title}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{m.body}</p>
            <span
              className="absolute inset-x-0 bottom-0 h-0.5 origin-left scale-x-0 transition-transform duration-300 group-hover:scale-x-100"
              style={{ background: m.accent }}
            />
          </Link>
        ))}
      </section>

      <section className="mt-16">
        <div className="panel flex flex-wrap items-center gap-x-6 gap-y-3 p-5">
          <div className="min-w-[12rem] flex-1">
            <h2 className="display text-2xl">It talks to you</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              Your face points at the floor during a push-up, which makes a scoreboard useless at
              the exact moment it has something to say. So the count is spoken, every no-rep is
              spoken with its reason, and form faults are called out while they are happening.
            </p>
          </div>
          <div className="flex shrink-0 gap-2 text-3xl" aria-hidden>
            🔊
          </div>
        </div>
      </section>

      <section className="mt-16">
        <h2 className="display text-3xl">On being strict about it</h2>
        <p className="mt-2 max-w-2xl leading-relaxed text-muted">
          There is a good argument against everything on this page. It goes: fixating on form is a
          self-imposed barrier, all that matters is area under the curve, do them daily and in
          quantity and the quality follows. People who have actually done ten thousand push-ups say
          this, and they are not wrong.
        </p>
        <p className="mt-3 max-w-2xl leading-relaxed text-muted">
          So the strictness is a setting, not a sermon. <span className="text-text">Casual</span>{" "}
          counts nearly anything that moves and exists for exactly that argument — if the habit is
          the thing you&apos;re building, take it and ignore the rest.{" "}
          <span className="text-text">Ranked</span> is stricter because a shared ladder is
          meaningless when everyone marks their own homework. Both are real; they answer different
          questions.
        </p>
      </section>

      <section className="mt-16">
        <h2 className="display text-3xl">What counts as a rep</h2>
        <p className="mt-2 max-w-2xl text-muted">
          Every ladder built on an honour system dies the same way. Four gates run on every
          repetition, and failing any one of them tells you which:
        </p>
        <div className="mt-6 grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
          {GATES.map(([name, body]) => (
            <div key={name} className="bg-ink-2 p-5">
              <h3 className="display text-lg text-you">{name}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted">{body}</p>
            </div>
          ))}
        </div>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-muted">
          Set the camera side-on, three or four steps back, so one whole side of your body is in
          frame — and if you get it wrong the app tells you which part is wrong, rather than just
          failing to count. Pose estimation runs on your own machine: the video is never uploaded,
          never recorded, and never seen by your opponent. All that crosses the network is a
          running count.
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted">
          Add it to your home screen and it opens full-screen with a shortcut straight into a set.
          The floor next to a propped-up phone is where this is meant to be used.
        </p>
      </section>

      <footer className="mt-16 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-6 text-sm text-muted">
        <span>
          Pose by MediaPipe, in your browser.
          {!ladderEnabled && " Ladder offline — solo play still works."}
        </span>
        <a
          href="https://github.com/nickzsche21/pushup-gg"
          className="underline decoration-line underline-offset-4 transition hover:text-text"
        >
          Source
        </a>
      </footer>
    </main>
  );
}

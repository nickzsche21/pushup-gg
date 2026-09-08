# PUSHUP.GG

Ranked 1v1 push-ups. Your webcam is the referee.

Two people, two cameras, one bar between them. Pose estimation runs in each
browser, counts the reps that actually qualify, and streams nothing but a
running total to the other side. Win, and the ladder moves.

**Live:** https://pushup-gg.vercel.app

---

## Why this exists

The genre — a scoreboard bolted over a workout clip — is everywhere, and all of
it is edited after the fact. Nobody is really being judged. The interesting
version is the one where a machine watches you and refuses to count the rep you
cut short, in front of an opponent, while it's happening.

So the whole product is the referee.

## What counts as a rep

Four gates run on every repetition. Failing one is announced, with the reason,
rather than silently dropped:

| Gate | Ranked threshold | Fails as |
|---|---|---|
| **Depth** | elbow angle breaks 95° | `NO REP · GO LOWER` |
| **Lockout** | elbow angle returns past 155° | (rep doesn't close) |
| **Body line** | shoulder–hip–ankle held above 152° | `NO REP · HIPS DROPPED` |
| **Tempo** | at least 380ms floor-to-lockout | `NO REP · TOO FAST` |

Losing tracking mid-rep voids the attempt (`NO REP · LOST YOU`) — otherwise you
could drop out of frame at the bottom and reappear locked out at the top.

Three strictness presets exist (`casual`, `ranked`, `strict`); ranked is the one
the ladder uses. Pass `?s=casual` to play a looser game.

## How it decides

Angles come from MediaPipe **world** landmarks — metres, hip-centred — not the
normalised image coordinates, so the judgement doesn't skew with your aspect
ratio or how far you are from the lens.

The elbow signal is median-of-3 filtered. The median is deliberate: it
annihilates single-frame landmark pops (a hand briefly tracked onto its own
shadow, which can otherwise fake depth) at a cost of one frame of lag, where the
exponential average this started as lagged the turnaround badly enough to steal
several degrees of real depth. The EMA is still computed, and is used only to
animate the on-screen gauge.

Depth credit comes from the **second**-lowest raw reading of the rep, so one bad
frame cannot manufacture a rep and a genuine turnaround isn't clipped by the
filter.

## Ratings

Elo from 1000, across six tiers from Bronze to Elite, with one change: margin
counts. A push-up match is not a binary — 21–20 and 21–3 are different results —
so the actual score is 70% who won and 30% the rep share. Placements move at
double K for five matches; ghost matches move you at half.

## Ghosts

A new ladder has an empty lobby, which kills it on day one. If nobody is queued
after nine seconds you're matched against a **ghost**: the rep timeline of a
real set someone already filmed at your rating, replayed live against your
clock. Every clean set of five or more becomes one. On a genuinely empty
database a synthetic pacer stands in — with fatigue, because a metronome is
demoralising in a way that teaches nothing.

## On cheating

The camera runs on the player's own machine. A determined person can lie to any
client, and this one is no exception — there is no server-side video, so there
is no way to be certain.

What exists is a plausibility floor, and it lives inside a `security definer`
Postgres function rather than in a route handler, so it still applies to someone
calling the RPC by hand with the public key:

- the rep count must match the submitted timeline
- every rep must land inside the match window
- no two reps closer than 250ms
- nothing above 2.5 reps/second sustained (the world record is near 1.7)
- Elo deltas are clamped to ±64 per match

A flagged match is recorded for the audit trail and otherwise does not exist: no
rating, no match count, no rep total, and no personal record. That last one
matters — an earlier version zeroed only the Elo, which still let a forged set
take the biggest-set board, which is the number people would actually screenshot.

## Privacy

Video never leaves your device. It is not uploaded, not recorded, and not
visible to your opponent. Pose estimation runs entirely in your browser, and the
only thing crossing the network is an integer.

The pose model and its WASM runtime are served from this origin rather than a
CDN, so the referee can't be broken by someone else's outage.

## Running it

```bash
npm install
npm run dev        # http://localhost:3444
npm test           # the referee's test suite
```

`npm run dev` and `npm run build` stage the pose runtime into `public/` first:
the WASM is copied out of `node_modules` so it can never drift from the
installed version, and the ~5.8 MB model is downloaded. If the download fails
the client falls back to the CDN, so a flaky build network isn't fatal.

Supabase is optional. Without it, solo play and the referee work exactly the
same and results are kept on the device; you lose the ladder, ghosts and private
rooms.

```bash
cp .env.example .env.local
```

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Ladder, ghosts, realtime matchmaking |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same |

There is no service-role key and no server route. Every write goes through
`pug_upsert_player` / `pug_apply_result`, which are `security definer` functions
with the validation inlined; RLS blocks direct table writes entirely and allows
public reads for the ladder.

## No camera?

Add `?sim=1` to any match URL for a simulated athlete — the same referee, the
same gates, the same overlay, with a generated pose stream instead of a webcam.
It's how the match flow gets exercised in CI, and it throws deliberate shallow
reps and dropped hips so the no-rep path is visible.

```
/play?mode=ranked&d=60&sim=1
```

## Known limits

- **Hidden tabs.** Browsers stop delivering animation frames to a background
  tab, so the camera stops counting while the clock runs on. A screen wake lock
  is held during a match, and the result tells you if it happened.
- **One camera angle.** Depth is measured side-on. Filming head-on hides the
  elbow, and the referee will mostly refuse to count.
- **Rate limiting.** There isn't any. Nothing stops a script from submitting a
  stream of plausible matches; the floor only bounds what each one is worth.

## Layout

```
src/lib/pose/repCounter.ts   the referee — state machine and form gates
src/lib/pose/geometry.ts     angle maths and the median filter
src/lib/pose/simulator.ts    synthetic athlete, shared by demo mode and tests
src/lib/elo.ts               margin-weighted ratings, plausibility floor
src/lib/net/match.ts         lobby, pairing, match channel, ghosts
src/lib/shareCard.ts         the 1080×1920 result card
src/components/CameraStage   camera, pose loop, overlay painting
scripts/test-counter.ts      25 assertions over the above
```

## Licence

MIT

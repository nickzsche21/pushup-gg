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

## What people said about the alternatives

Every feature past the referee came out of reading what people actually
complain about, rather than guessing. The two closest products on Hacker News
([a webcam push-up counter](https://news.ycombinator.com/item?id=16095477),
134 points, and [a real-time form corrector](https://news.ycombinator.com/item?id=43331940),
45 points) plus fitness.stackexchange sorted by views:

**Every counter is trivially cheatable, and people notice within one comment.**
*"So if I move the phone up and down in front of my face it will count
push-ups?"* · *"I just moved up and down and it detected that as a push up"* ·
*"I managed to fool it by hand movements"* · *"I was able to fool it by doing
pushups off my desk."* And the flip side, unprompted: *"has the added benefit of
not letting people count those half-pushups where you're still 12 inches off the
ground."* → the four gates.

**Your face points at the floor.** *"Can this app give an audible alert when
form falls beyond threshold?"* · *"This is also easy to coach in real time with
audio cues."* A visual HUD is unreadable at exactly the moment it has something
to say. → [the coach](#it-talks-to-you).

**Nobody can work out where to put the camera.** *"You have to be fairly close
to the screen for it to count"* · *"there is no space near my webcam that I can
knock out some pushups"* · and the author himself: *"I'll look at ways to help
people get into that position first time round."* → [the framing coach](#the-framing-coach).

**Tempo is the top form request, and the leading paid app doesn't have it.**
*"Is pace considered in form? Slowing down the eccentric motion is one of the
most important things."* Author's reply: *"No, pace is not considered in our form
feedback."* → per-rep eccentric/concentric split.

**The real problem isn't counting, it's plateauing.** *"My push-ups don't
increase"* — 24,760 views. *"Why is 40 pushups a day not doing anything?"* —
18,967 views. → [training](#training).

**Beginners are excluded entirely.** Most people cannot do one clean full
push-up, and every one of these apps refuses to count anything else. → knee and
incline variations, with the body line measured to the right joint.

**The unit is the day, not the session.** From the thread of someone who
actually did it: *"On Saturday I did 527 push-ups. A set of 30 in the morning,
then 400 on the soccer field — in 16 sets of 25, every five minutes."* ·
*"Once you can do 100 in a set, that's just ten sets throughout the day."* ·
*"All that matters is area under the curve."* → [log a set](#log-a-set), and a
running daily total rather than a session score.

**Administrative faff is the stated reason people quit.** *"I have fallen off
several wagons — Convict Conditioning, the Busy Dad Routine — generally because,
although fun and encouraging initially, they are just too much faff from an
administrative perspective."* → no briefing screen, no target, no navigation
between sets.

**People keep spreadsheets.** One commenter asked another for the exact columns
of his. → a progress chart and a CSV export button.

**And a direct challenge to this whole product**, which deserved an answer
rather than a feature: *"You're fixating on the wrong thing (form) as a
self-imposed barrier to progress. Just do what you can, do them daily, forget
the form."* → see [On being strict about it](#on-being-strict-about-it).

**Also:** elbow flare is a named fault nobody detects; counting *down* toward a
target is what gets people through a set (*"chunking and counting down helped go
through them"*); the local-only processing was praised without being asked
about; and one reported bug worth stealing — *"the webcam is still turned on
after the pushup detection is done"* — which is why the camera is released the
moment a set ends here.

## What counts as a rep

Four gates run on every repetition. Failing one is announced, with the reason,
rather than silently dropped:

| Gate | Ranked threshold | Fails as |
|---|---|---|
| **Depth** | elbow angle breaks 95° | `NO REP · GO LOWER` |
| **Lockout** | elbow angle returns past 155° | (rep doesn't close) |
| **Body line** | shoulder–hip–ankle held above 152° | `NO REP · HIPS DROPPED` |
| **Tempo** | at least 380ms floor-to-lockout | `NO REP · TOO FAST` |
| **Elbow flare** | upper arm within 82° of the torso | `NO REP · ELBOWS OUT` (strict only) |

Losing tracking mid-rep voids the attempt (`NO REP · LOST YOU`) — otherwise you
could drop out of frame at the bottom and reappear locked out at the top.

Flare is measured on every rep and coached out loud, but only voids the rep
under strict rules. It is the most common fault there is, and an app that
refuses to count a beginner's honest work teaches them nothing.

Every rep also records its **eccentric and concentric halves** separately.
Nothing is gated on them — they feed the form report, because "you dropped in
0.3 seconds" is the most useful thing anyone can tell you about a push-up.

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

## Log a set

The main loop. No target, no countdown, no briefing, no screens between sets:
the camera stays live, it starts when you hold a plank, and it stops ten seconds
after your last rep. "Another set" drops straight back into position without
tearing the camera down.

Above it, all day, sits one number: **today's total, across every set**. That is
the number the person who did ten thousand push-ups was actually tracking, and
it is a different shape of product from a session score.

Depth, strictness, variation and the coach are behind one line of text you only
open if you want them.

## On being strict about it

There is a good argument against this entire app, and people who have done ten
thousand push-ups make it: fixating on form is a self-imposed barrier, area
under the curve is all that matters, do them daily and the quality follows.

So strictness is a setting, not a sermon:

| | Depth | Body line | Tempo | Flare |
|---|---|---|---|---|
| **Casual** | 105° | 140° | 300ms | warn only |
| **Ranked** | 95° | 152° | 380ms | warn only |
| **Strict** | 85° | 160° | 450ms | **voids the rep** |

Casual exists for exactly that argument — if the habit is the thing you're
building, take it and ignore everything else here. Ranked is stricter because a
shared ladder is meaningless when everyone marks their own homework. They answer
different questions and both are real.

## Progress, and your data back

Daily volume as bars with your best single set drawn over the top. Two questions
get confused constantly — "am I doing more work" and "am I getting stronger" —
and only the second one stalls. Plotting them together is what makes a plateau
visible instead of a vibe.

There's an **Export CSV** button. Nothing here is worth trapping.

## Install it

There's a web manifest and icons, so it installs to a home screen and opens
full-screen with no browser chrome eating the count. The shortcut menu goes
straight into a set. The floor next to a propped-up phone is where this is meant
to be used, not a desk.

## It talks to you

The count is spoken. Every no-rep is spoken with its reason — "lower", "hips",
"slower", "elbows in". Faults are called out while they're still happening, and
the last ten seconds of a match are announced. Tones carry the timing because
speech synthesis is too slow to land on a rep: the blip fires as the rep closes
and the number follows it.

Browsers won't start audio without a real gesture, so it arms on the first tap
anywhere on the page, and there's an explicit toggle on every setup screen.

## The framing coach

Instead of "get into position", it names the actual problem and what to do:

- *"Put the camera at your side"* — head-on, it cannot see your elbows bend,
  which is the entire measurement
- *"Your legs are out of shot"* — the body-line check needs hip to ankle
- *"Camera closer"* / *"Camera back"* — from how much of the frame you fill
- *"I can't see you"*

Verdicts are held for 700ms before being acted on, because raw per-frame
analysis flickers and advice that rewrites itself thirty times a second is
unreadable. The match won't start until framing is good *and* you've held a
plank for 1.2s.

## Training

The ranked ladder answers "who is better". It does not answer "why am I not
getting better", which is what people actually ask. So there's a second half:

- **Test** your max set to failure. Everything is a percentage of that, not of
  a number off the internet.
- **Volume** — five sets from 65% down to 50%, roughly 3× your best set of total
  work, none of it to failure.
- **Ladder** — 1,2,3…up and back down, resting four seconds per rep.
  Accumulates real volume while every single set stays easy.
- **Every minute** — a fixed number at the top of each minute for ten minutes.
  The rest shrinks as you slow down, which is the point.

Those three rotate, each week adds 4% to the working percentages (capped at
32%), and a re-test falls due every 21 days. Streaks count distinct days, not
sessions — three sets on Tuesday is still one day of showing up.

Target sets count **down**, and the coach speaks the number remaining.

## Variations

Knee, incline, standard, wide, diamond, decline, archer.

Only the knee variation changes what the referee measures: its body line runs
shoulder–hip–**knee**, because the shins leave the floor by design and an ankle
reference would fail every rep. The rest keep the same gates — from a side-on
camera you cannot see hand spacing, because the wrists overlap, so the app
records the variation you chose rather than pretending to verify it. Each gets
its own records board so that stays honest, and only standard push-ups move a
rating.

## The form report

After every set, per rep: depth against the gate, and the lowering/pressing
split as a stacked bar. Then averages, total time under tension, and exactly one
thing to fix — chosen by whichever signal is furthest out of line, whether
that's a repeated no-rep reason, a rushed descent, flared elbows, or depth
drifting shallower as the set wears on.

## One honest caveat about push-ups

Push-ups on their own build an imbalance — chest and front shoulder get strong
while the upper back doesn't. If this app is most of your training, put a
pulling movement next to it. It can't count those, and it isn't going to pretend
the problem isn't there.

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
  elbow, and the referee will mostly refuse to count — the framing coach says so
  rather than letting you find out after a set.
- **Variations are declared, not verified.** A side-on camera cannot see hand
  spacing. Selecting "diamond" and doing wide push-ups will be recorded as
  diamond.
- **Depth costs two frames.** Credit requires two consecutive readings past the
  gate, which is what stops a single bad landmark counting. At 30fps that is
  about 5° of extra depth on a normal rep and more on a fast one.
- **Rate limiting.** There isn't any. Nothing stops a script from submitting a
  stream of plausible matches; the floor only bounds what each one is worth.
- **Training data is local.** Streaks, daily totals and the progress chart live
  in this browser's storage. Clearing site data loses them — export the CSV.
- **Push only.** See above. This is half a training programme by construction.

## Layout

```
src/lib/pose/repCounter.ts   the referee — state machine and form gates
src/lib/pose/geometry.ts     angle maths and the median filter
src/lib/pose/variations.ts   seven variations and their gate overrides
src/lib/pose/simulator.ts    synthetic athlete, shared by demo mode and tests
src/lib/coach/audio.ts       spoken counts, no-rep reasons, tones
src/lib/coach/framing.ts     camera setup diagnosis
src/lib/training.ts          progression, plans, streaks, daily totals, CSV
src/lib/elo.ts               margin-weighted ratings, plausibility floor
src/lib/net/match.ts         lobby, pairing, match channel, ghosts
src/lib/shareCard.ts         the 1080×1920 result card
src/components/CameraStage   camera, pose loop, overlay painting
src/components/FormReport    per-rep depth and tempo, and the one thing to fix
src/components/ProgressChart daily volume against best single set
src/app/set/                 the zero-friction daily loop
scripts/test-counter.ts      77 assertions over the above
```

## Licence

MIT

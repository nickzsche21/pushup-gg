"use client";

import type { NoRepReason } from "../pose/repCounter";

/**
 * The voice in your ear.
 *
 * During a push-up your face points at the floor, which makes a screen-only
 * HUD unreadable at exactly the moment it has something to say. Everything the
 * referee decides is therefore also spoken: the count, the reason a rep didn't
 * count, and the one thing to fix.
 *
 * Tones carry the timing because speech synthesis is too slow to land on a rep
 * — the blip fires the instant the rep closes and the number follows it.
 */

const CUE_TEXT: Record<NoRepReason, string> = {
  shallow: "Lower",
  hips: "Hips",
  fast: "Slower",
  lost: "Can't see you",
  flare: "Elbows in",
};

export interface CoachOptions {
  speak: boolean;
  tones: boolean;
  /** Speak the running count out loud on every rep. */
  countAloud: boolean;
}

export const DEFAULT_COACH: CoachOptions = { speak: true, tones: true, countAloud: true };

export class Coach {
  private ctx: AudioContext | null = null;
  private opts: CoachOptions;
  private lastCueAt = 0;
  private lastCue = "";
  private voice: SpeechSynthesisVoice | null = null;

  constructor(opts: CoachOptions = DEFAULT_COACH) {
    this.opts = { ...opts };
  }

  set options(o: CoachOptions) {
    this.opts = { ...o };
    if (!o.speak) this.hush();
  }

  /**
   * Must be called from a real user gesture. Browsers refuse to start audio
   * otherwise, and a coach that is silent for the first rep is worse than none.
   */
  async arm() {
    if (this.opts.tones) {
      try {
        type Ctor = typeof AudioContext;
        const AC = (window.AudioContext ?? (window as unknown as { webkitAudioContext: Ctor }).webkitAudioContext);
        this.ctx ??= new AC();
        if (this.ctx.state === "suspended") await this.ctx.resume();
      } catch {
        this.ctx = null;
      }
    }
    if (this.opts.speak && typeof speechSynthesis !== "undefined") {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.voice = vs.find((v) => /^en[-_]/i.test(v.lang) && v.localService) ?? vs.find((v) => /^en/i.test(v.lang)) ?? null;
      };
      pick();
      if (!this.voice) speechSynthesis.addEventListener("voiceschanged", pick, { once: true });
    }
  }

  private tone(freq: number, ms: number, type: OscillatorType = "sine", gain = 0.16) {
    if (!this.opts.tones || !this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;

    // Ramp both ends — a square wave switched on hard clicks unpleasantly.
    const t0 = ctx.currentTime;
    amp.gain.setValueAtTime(0, t0);
    amp.gain.linearRampToValueAtTime(gain, t0 + 0.008);
    amp.gain.exponentialRampToValueAtTime(0.0001, t0 + ms / 1000);

    osc.connect(amp).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + ms / 1000 + 0.02);
  }

  private utter(text: string, { interrupt = false, rate = 1.15 } = {}) {
    if (!this.opts.speak || typeof speechSynthesis === "undefined") return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = rate;
    u.pitch = 1;
    if (this.voice) u.voice = this.voice;
    speechSynthesis.speak(u);
  }

  private hush() {
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
  }

  /** A good rep. The blip is immediate; the number interrupts any older one. */
  rep(n: number) {
    this.tone(920, 90);
    if (this.opts.countAloud) this.utter(String(n), { interrupt: true, rate: 1.35 });
  }

  noRep(reason: NoRepReason) {
    this.tone(190, 220, "square", 0.13);
    this.utter(CUE_TEXT[reason], { interrupt: true, rate: 1.25 });
  }

  /**
   * Coaching that isn't tied to a rep. Throttled hard: a coach that talks over
   * itself every second is one people mute, and a muted coach helps nobody.
   */
  cue(text: string, { minGapMs = 3500 } = {}) {
    const now = Date.now();
    if (text === this.lastCue && now - this.lastCueAt < minGapMs * 2) return;
    if (now - this.lastCueAt < minGapMs) return;
    this.lastCueAt = now;
    this.lastCue = text;
    this.utter(text);
  }

  countdown(n: number) {
    this.tone(n === 0 ? 1320 : 640, n === 0 ? 260 : 110);
    this.utter(n === 0 ? "Go" : String(n), { interrupt: true, rate: 1.3 });
  }

  /** Last ten seconds of a timed match. */
  warn() {
    this.tone(760, 120);
  }

  finish(summary?: string) {
    this.tone(560, 140);
    setTimeout(() => this.tone(840, 240), 150);
    if (summary) setTimeout(() => this.utter(summary), 420);
  }

  say(text: string) {
    this.utter(text, { interrupt: true });
  }

  dispose() {
    this.hush();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

const KEY = "pug.coach";

export function loadCoachOptions(): CoachOptions {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_COACH, ...(JSON.parse(raw) as Partial<CoachOptions>) };
  } catch {
    /* fall through to defaults */
  }
  return DEFAULT_COACH;
}

export function saveCoachOptions(o: CoachOptions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(o));
  } catch {
    /* private browsing */
  }
}

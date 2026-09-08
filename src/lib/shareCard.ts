"use client";

import { tierFor } from "./ranks";

export interface CardData {
  mode: string;
  durationS: number;
  me: { handle: string; reps: number; noReps: number; rating: number; delta: number; timeline: number[] };
  opp: { handle: string; reps: number; rating: number; isGhost: boolean; curve: Array<[number, number]> } | null;
}

const W = 1080;
const H = 1920;

/** next/font generates a hashed family name and exposes it on this variable. */
function displayFamily() {
  if (typeof document === "undefined") return "system-ui, sans-serif";
  const v = getComputedStyle(document.documentElement).getPropertyValue("--font-condensed").trim();
  return v ? `${v}, "Arial Narrow", system-ui, sans-serif` : `"Arial Narrow", system-ui, sans-serif`;
}

/** Cumulative rep count at time t, from a list of rep timestamps. */
function curveFrom(timeline: number[]): Array<[number, number]> {
  return timeline.map((t, i) => [t, i + 1] as [number, number]);
}

export async function renderShareCard(d: CardData): Promise<Blob> {
  try {
    await document.fonts.ready;
  } catch {
    /* fonts are cosmetic here */
  }

  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");

  const fam = displayFamily();
  const YOU = "#24e07f";
  const THEM = "#ff4767";
  const MUTED = "#7b8698";

  const won = d.opp ? d.me.reps > d.opp.reps : true;
  const drew = d.opp ? d.me.reps === d.opp.reps : false;

  // ---- background -------------------------------------------------------
  ctx.fillStyle = "#06080e";
  ctx.fillRect(0, 0, W, H);
  const wash = ctx.createRadialGradient(W * 0.5, H * 0.28, 40, W * 0.5, H * 0.28, W * 0.95);
  wash.addColorStop(0, drew ? "rgba(240,180,41,0.16)" : won ? "rgba(36,224,127,0.18)" : "rgba(255,71,103,0.16)");
  wash.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = wash;
  ctx.fillRect(0, 0, W, H);

  const text = (
    s: string,
    x: number,
    y: number,
    size: number,
    color: string,
    align: CanvasTextAlign = "left",
    weight = 800,
  ) => {
    ctx.font = `${weight} ${size}px ${fam}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };

  // ---- header -----------------------------------------------------------
  text("PUSHUP.GG", 72, 130, 46, "#e9edf6");
  text(d.opp?.isGhost ? "GHOST MATCH" : d.mode.toUpperCase(), W - 72, 130, 34, MUTED, "right");

  // ---- verdict ----------------------------------------------------------
  const verdict = drew ? "DRAW" : won ? "WIN" : "LOSS";
  text(verdict, W / 2, 330, 200, drew ? "#f0b429" : won ? YOU : THEM, "center");

  // ---- scoreline --------------------------------------------------------
  const boxY = 420;
  text(d.me.handle.toUpperCase().slice(0, 14), W * 0.27, boxY + 60, 44, "#e9edf6", "center");
  text(String(d.me.reps), W * 0.27, boxY + 210, 170, YOU, "center");

  text("VS", W / 2, boxY + 160, 48, MUTED, "center");

  if (d.opp) {
    text(d.opp.handle.toUpperCase().slice(0, 14), W * 0.73, boxY + 60, 44, "#e9edf6", "center");
    text(String(d.opp.reps), W * 0.73, boxY + 210, 170, THEM, "center");
  } else {
    text("—", W * 0.73, boxY + 210, 170, MUTED, "center");
  }

  // ---- race graph -------------------------------------------------------
  const gx = 96;
  const gy = 760;
  const gw = W - gx * 2;
  const gh = 480;

  const mine = curveFrom(d.me.timeline);
  const theirs = d.opp?.curve ?? [];
  const maxReps = Math.max(4, d.me.reps, d.opp?.reps ?? 0);
  const maxT = Math.max(
    1000,
    d.durationS > 0 ? d.durationS * 1000 : Math.max(mine.at(-1)?.[0] ?? 0, theirs.at(-1)?.[0] ?? 0),
  );

  ctx.strokeStyle = "#1e2637";
  ctx.lineWidth = 2;
  for (let i = 0; i <= 4; i++) {
    const y = gy + (gh / 4) * i;
    ctx.beginPath();
    ctx.moveTo(gx, y);
    ctx.lineTo(gx + gw, y);
    ctx.stroke();
  }
  text(String(maxReps), gx - 18, gy + 12, 28, MUTED, "right", 700);
  text("0", gx - 18, gy + gh + 10, 28, MUTED, "right", 700);
  text("REPS OVER TIME", gx, gy - 26, 30, MUTED, "left", 700);

  const line = (pts: Array<[number, number]>, color: string) => {
    if (pts.length === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 7;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(gx, gy + gh);
    for (const [t, n] of pts) {
      ctx.lineTo(gx + (Math.min(t, maxT) / maxT) * gw, gy + gh - (n / maxReps) * gh);
    }
    ctx.stroke();
  };
  line(theirs, THEM);
  line(mine, YOU);

  // ---- stat strip -------------------------------------------------------
  const sy = 1400;
  ctx.strokeStyle = "#1e2637";
  ctx.beginPath();
  ctx.moveTo(72, sy - 60);
  ctx.lineTo(W - 72, sy - 60);
  ctx.stroke();

  const gaps = d.me.timeline.slice(1).map((t, i) => t - d.me.timeline[i]);
  const avgGap = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length / 1000 : 0;

  const stats: Array<[string, string, string]> = [
    ["NO REPS", String(d.me.noReps), d.me.noReps > 0 ? THEM : "#e9edf6"],
    ["AVG PACE", avgGap ? `${avgGap.toFixed(1)}s` : "—", "#e9edf6"],
    ["RATING", `${d.me.rating}`, tierFor(d.me.rating).color],
    ["CHANGE", `${d.me.delta >= 0 ? "+" : ""}${d.me.delta}`, d.me.delta >= 0 ? YOU : THEM],
  ];
  stats.forEach(([label, value, color], i) => {
    const x = 72 + (gw / 4) * i + gw / 8;
    text(label, x, sy + 10, 30, MUTED, "center", 700);
    text(value, x, sy + 92, 76, color, "center");
  });

  // ---- footer -----------------------------------------------------------
  text(tierFor(d.me.rating).name, W / 2, 1660, 56, tierFor(d.me.rating).color, "center");
  text("every rep judged on depth, lockout, body line and tempo", W / 2, 1730, 30, MUTED, "center", 700);
  text("PUSHUP.GG", W / 2, 1830, 52, "#e9edf6", "center");

  return new Promise<Blob>((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"),
  );
}

export async function shareCard(blob: Blob, filename: string) {
  const file = new File([blob], filename, { type: "image/png" });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };

  if (nav.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: "PUSHUP.GG" });
      return "shared" as const;
    } catch {
      // User dismissed the sheet — fall through to a download.
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return "downloaded" as const;
}

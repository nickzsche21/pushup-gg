export interface Tier {
  name: string;
  min: number;
  color: string;
  glow: string;
}

export const TIERS: Tier[] = [
  { name: "BRONZE", min: 0, color: "#c2703d", glow: "rgba(194,112,61,0.45)" },
  { name: "SILVER", min: 900, color: "#b7c3cf", glow: "rgba(183,195,207,0.45)" },
  { name: "GOLD", min: 1100, color: "#f0b429", glow: "rgba(240,180,41,0.5)" },
  { name: "PLATINUM", min: 1300, color: "#34d3c4", glow: "rgba(52,211,196,0.5)" },
  { name: "DIAMOND", min: 1500, color: "#6aa8ff", glow: "rgba(106,168,255,0.5)" },
  { name: "ELITE", min: 1700, color: "#c77dff", glow: "rgba(199,125,255,0.55)" },
];

export function tierFor(rating: number): Tier {
  let out = TIERS[0];
  for (const t of TIERS) if (rating >= t.min) out = t;
  return out;
}

/** Progress through the current tier, 0–1. Elite is open-ended. */
export function tierProgress(rating: number): number {
  const t = tierFor(rating);
  const next = TIERS[TIERS.indexOf(t) + 1];
  if (!next) return Math.min(1, (rating - t.min) / 300);
  return Math.min(1, Math.max(0, (rating - t.min) / (next.min - t.min)));
}

export const PLACEMENT_MATCHES = 5;

import type { CounterConfig, Strictness } from "./repCounter";
import { STRICTNESS } from "./repCounter";

export interface Variation {
  id: string;
  name: string;
  blurb: string;
  level: "beginner" | "standard" | "advanced";
  /** Eligible for the 1v1 ladder. Only one is, so matches compare like with like. */
  ranked: boolean;
  override: Partial<CounterConfig>;
}

/**
 * Push-up variations, from "can't do one yet" to "showing off".
 *
 * Only the knee variation changes what the referee measures — its body line
 * runs shoulder–hip–knee, because the shins leave the floor by design and an
 * ankle reference would fail every rep. The rest keep the same gates: from a
 * side-on camera you cannot see hand spacing (the wrists overlap), so the app
 * records the variation you chose rather than pretending to verify it. Each one
 * gets its own records board so that stays honest.
 */
export const VARIATIONS: Variation[] = [
  {
    id: "knee",
    name: "Knee",
    blurb: "Knees down. The honest starting point — most people can't do one full rep, and this still counts.",
    level: "beginner",
    ranked: false,
    override: { bodyLineJoint: "knee", bodyLineMin: 148 },
  },
  {
    id: "incline",
    name: "Incline",
    blurb: "Hands on a chair or step. Raise the hands to lower the difficulty; work the surface down over weeks.",
    level: "beginner",
    ranked: false,
    override: {},
  },
  {
    id: "standard",
    name: "Standard",
    blurb: "Hands under the shoulders, body in one line. The only variation the ranked ladder accepts.",
    level: "standard",
    ranked: true,
    override: {},
  },
  {
    id: "wide",
    name: "Wide",
    blurb: "Hands wider than the shoulders. More chest, and the elbow-flare gate matters most here.",
    level: "standard",
    ranked: false,
    override: { maxFlare: 88 },
  },
  {
    id: "diamond",
    name: "Diamond",
    blurb: "Hands together under the sternum. Triceps do the work and the elbows must stay tucked.",
    level: "advanced",
    ranked: false,
    override: { maxFlare: 55 },
  },
  {
    id: "decline",
    name: "Decline",
    blurb: "Feet elevated. Shifts load onto the shoulders and makes the body line much harder to hold.",
    level: "advanced",
    ranked: false,
    override: { bodyLineMin: 158 },
  },
  {
    id: "archer",
    name: "Archer",
    blurb: "One arm bends, the other stays straight. The step before a one-arm push-up.",
    level: "advanced",
    ranked: false,
    // The referee already reads the more-bent arm, which is the working one.
    override: { minRepMs: 500 },
  },
];

export const DEFAULT_VARIATION = "standard";

export function variation(id: string | null | undefined): Variation {
  return VARIATIONS.find((v) => v.id === id) ?? VARIATIONS.find((v) => v.id === DEFAULT_VARIATION)!;
}

export function configFor(strictness: Strictness, variationId?: string | null): CounterConfig {
  return { ...STRICTNESS[strictness], ...variation(variationId).override };
}

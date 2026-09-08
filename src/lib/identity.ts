"use client";

const ID_KEY = "pug.playerId";
const HANDLE_KEY = "pug.handle";

const ADJECTIVES = [
  "IRON", "SILENT", "FERAL", "GRIM", "RAPID", "STONE", "VOID", "BLUNT",
  "HOLLOW", "SHARP", "COLD", "BRUTAL", "LEAN", "STEADY", "WIRED",
];
const NOUNS = [
  "PISTON", "HAMMER", "ENGINE", "PLANK", "ANVIL", "MACHINE", "CRANK",
  "SPRING", "BOLT", "GRINDER", "LEVER", "DRIVE", "TORQUE",
];

export function randomHandle() {
  const a = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const n = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${a}_${n}${Math.floor(Math.random() * 90 + 10)}`;
}

/**
 * The player id doubles as the account secret — whoever holds it owns that
 * ladder row. There are no passwords here on purpose; clearing site data
 * starts you over, which is the honest trade for zero-friction play.
 */
export function playerId(): string {
  let id = localStorage.getItem(ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(ID_KEY, id);
  }
  return id;
}

export function handle(): string {
  let h = localStorage.getItem(HANDLE_KEY);
  if (!h) {
    h = randomHandle();
    localStorage.setItem(HANDLE_KEY, h);
  }
  return h;
}

export function setHandle(h: string) {
  localStorage.setItem(HANDLE_KEY, h.trim().slice(0, 18) || randomHandle());
}

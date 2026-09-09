import type { MetadataRoute } from "next";

/**
 * Installable, because the real posture for this is a phone on the floor
 * propped against a wall — not a laptop on a desk. Installed, it opens
 * full-screen with no browser chrome eating the count, and the "Log a set"
 * shortcut lands straight in the camera.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "PUSHUP.GG — ranked push-ups",
    short_name: "PUSHUP.GG",
    description:
      "Ranked 1v1 push-ups judged by your webcam. Depth, lockout, body line, elbow flare and tempo checked on every rep, spoken out loud. Video never leaves your device.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#06080e",
    theme_color: "#06080e",
    categories: ["health", "fitness", "sports"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Log a set", short_name: "Set", url: "/set" },
      { name: "Ranked match", short_name: "Ranked", url: "/play?mode=ranked&d=60" },
      { name: "Training", short_name: "Train", url: "/train" },
    ],
  };
}

/**
 * Stages the pose-detection runtime into public/ before a build.
 *
 * The WASM is copied out of node_modules so it can never drift from the
 * installed @mediapipe/tasks-vision version. The model is downloaded from
 * Google's model bucket. Both are gitignored; if the download fails the client
 * falls back to the CDN at runtime, so a flaky build network is not fatal.
 */
import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const root = process.cwd();

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
const MODEL_DEST = path.join(root, "public", "models", "pose_landmarker_lite.task");

async function copyWasm() {
  // The package does not export ./package.json, so resolve the main entry instead.
  const pkg = path.dirname(require.resolve("@mediapipe/tasks-vision"));
  const src = path.join(pkg, "wasm");
  const dest = path.join(root, "public", "mediapipe", "wasm");
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
  console.log("[assets] wasm staged from", path.relative(root, src));
}

async function fetchModel() {
  try {
    const s = await stat(MODEL_DEST);
    if (s.size > 1_000_000) {
      console.log("[assets] model already present, skipping download");
      return;
    }
  } catch {
    /* not there yet */
  }

  await mkdir(path.dirname(MODEL_DEST), { recursive: true });
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(MODEL_DEST, buf);
  console.log(`[assets] model downloaded (${(buf.length / 1e6).toFixed(1)} MB)`);
}

await copyWasm();
try {
  await fetchModel();
} catch (err) {
  console.warn("[assets] model download failed, client will use the CDN:", err.message);
}

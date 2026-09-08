import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Pt } from "./geometry";

const LOCAL_WASM = "/mediapipe/wasm";
const LOCAL_MODEL = "/models/pose_landmarker_lite.task";
const CDN_WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const CDN_MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

export interface PoseResult {
  world: Pt[] | null;
  image: Pt[] | null;
}

let cached: PoseLandmarker | null = null;
let loading: Promise<PoseLandmarker> | null = null;

async function reachable(url: string) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Loads the pose model once per page. Prefers the copies served from our own
 * origin (staged by scripts/prepare-assets.mjs) and falls back to the public
 * CDN so a fresh clone without a build step still runs.
 */
export async function loadLandmarker(): Promise<PoseLandmarker> {
  if (cached) return cached;
  if (loading) return loading;

  loading = (async () => {
    const useLocalModel = await reachable(LOCAL_MODEL);
    const wasmPath = useLocalModel ? LOCAL_WASM : CDN_WASM;
    const modelPath = useLocalModel ? LOCAL_MODEL : CDN_MODEL;

    const fileset = await FilesetResolver.forVisionTasks(wasmPath);

    const build = (delegate: "GPU" | "CPU") =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelPath, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });

    try {
      cached = await build("GPU");
    } catch {
      // Older integrated GPUs and locked-down browsers refuse WebGL here.
      cached = await build("CPU");
    }
    return cached;
  })();

  try {
    return await loading;
  } catch (err) {
    loading = null;
    throw err;
  }
}

export function detect(lm: PoseLandmarker, video: HTMLVideoElement, tMs: number): PoseResult {
  const res = lm.detectForVideo(video, tMs);
  return {
    world: res.worldLandmarks?.[0] ?? null,
    image: res.landmarks?.[0] ?? null,
  };
}

/** Bones drawn on the overlay — head is skipped, it tells you nothing here. */
export const SKELETON: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28],
];

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SKELETON, detect, loadLandmarker } from "@/lib/pose/landmarker";
import { L } from "@/lib/pose/geometry";
import { NoRepEvent, RepCounter, RepEvent, Strictness, STRICTNESS } from "@/lib/pose/repCounter";
import { SimulatedAthlete } from "@/lib/pose/simulator";

export type StageStatus = "idle" | "camera" | "model" | "ready" | "error";

interface Props {
  strictness: Strictness;
  /** When true, reps count. Flipping it on resets the counter. */
  armed: boolean;
  onRep?: (r: RepEvent) => void;
  onNoRep?: (n: NoRepEvent) => void;
  onStatus?: (s: StageStatus, message?: string) => void;
  /** Fires when the athlete has held a plank long enough to start. */
  onInPosition?: (ready: boolean) => void;
  /**
   * Demo mode: drive the referee from a simulated athlete instead of a camera.
   * Same counter, same gates, same overlay — only the landmark source changes,
   * so it is also how the match flow gets exercised in tests.
   */
  simulate?: boolean;
}

export default function CameraStage({ strictness, armed, onRep, onNoRep, onStatus, onInPosition, simulate }: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(-1);
  const armedRef = useRef(armed);
  const positionRef = useRef(false);

  const [status, setStatus] = useState<StageStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const push = useCallback(
    (s: StageStatus, message?: string) => {
      setStatus(s);
      onStatus?.(s, message);
    },
    [onStatus],
  );

  // Callbacks live in refs so the render loop is never rebuilt mid-match.
  const cbRef = useRef({ onRep, onNoRep, onInPosition });
  cbRef.current = { onRep, onNoRep, onInPosition };

  useEffect(() => {
    if (armed && counterRef.current) {
      counterRef.current.reset();
      positionRef.current = false;
    }
    armedRef.current = armed;
  }, [armed]);

  useEffect(() => {
    let cancelled = false;
    let stream: MediaStream | null = null;

    const counter = new RepCounter(
      strictness,
      (r) => armedRef.current && cbRef.current.onRep?.(r),
      (n) => armedRef.current && cbRef.current.onNoRep?.(n),
    );
    counterRef.current = counter;

    if (simulate) {
      const athlete = new SimulatedAthlete();
      push("ready");
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const c = canvasRef.current;
        if (!c) return;
        const ts = performance.now();
        if (ts <= lastTsRef.current) return;
        lastTsRef.current = ts;

        const { world, image } = athlete.sample(ts);
        const frame = counter.update(world, image, ts);

        if (!armedRef.current) {
          const ready = counter.readyFor(1200, ts);
          if (ready !== positionRef.current) {
            positionRef.current = ready;
            cbRef.current.onInPosition?.(ready);
          }
        }
        draw(c, { videoWidth: 960, videoHeight: 540 }, image, frame, STRICTNESS[strictness], armedRef.current);
        // Demo mode exposes the referee's view for threshold tuning.
        (window as unknown as { __pug?: unknown }).__pug = {
          ...frame,
          reps: counter.count,
          noReps: counter.noReps.length,
          ready: counter.readyFor(1200, ts),
        };
      };
      rafRef.current = requestAnimationFrame(loop);
      return () => {
        cancelled = true;
        if (rafRef.current) cancelAnimationFrame(rafRef.current);
      };
    }

    (async () => {
      try {
        push("camera");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30 } },
          audio: false,
        });
        if (cancelled) return;

        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        await video.play();

        push("model");
        const lm = await loadLandmarker();
        if (cancelled) return;
        push("ready");

        const loop = () => {
          rafRef.current = requestAnimationFrame(loop);
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.readyState < 2) return;

          // MediaPipe's VIDEO mode rejects a timestamp it has already seen.
          const ts = performance.now();
          if (ts <= lastTsRef.current) return;
          lastTsRef.current = ts;

          let world = null;
          let image = null;
          try {
            const r = detect(lm, v, ts);
            world = r.world;
            image = r.image;
          } catch {
            return; // a dropped frame is not worth tearing the loop down
          }

          const frame = counter.update(world, image, ts);

          if (!armedRef.current) {
            const ready = counter.readyFor(1200, ts);
            if (ready !== positionRef.current) {
              positionRef.current = ready;
              cbRef.current.onInPosition?.(ready);
            }
          }

          draw(c, v, image, frame, STRICTNESS[strictness], armedRef.current);
        };
        rafRef.current = requestAnimationFrame(loop);
      } catch (err) {
        if (cancelled) return;
        const e = err as DOMException;
        const msg =
          e?.name === "NotAllowedError"
            ? "Camera blocked. Allow camera access in your browser, then reload."
            : e?.name === "NotFoundError"
              ? "No camera found on this device."
              : `Couldn't start the camera: ${e?.message ?? String(err)}`;
        setError(msg);
        push("error", msg);
      }
    })();

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [strictness, push, simulate]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {simulate ? (
        <div className="absolute inset-0 bg-gradient-to-b from-ink-2 to-black" />
      ) : (
        <video ref={videoRef} playsInline muted className="h-full w-full scale-x-[-1] object-cover" />
      )}
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full scale-x-[-1] object-cover" />

      {simulate && status === "ready" && (
        <p className="display absolute left-3 top-3 z-10 rounded-md bg-gold/20 px-2 py-1 text-[10px] tracking-[0.15em] text-gold">
          DEMO ATHLETE · NO CAMERA
        </p>
      )}

      {status !== "ready" && (
        <div className="absolute inset-0 grid place-items-center bg-ink/85 p-6 text-center">
          <div>
            <p className="display text-2xl text-text">
              {status === "error" ? "Camera unavailable" : status === "model" ? "Loading the referee" : "Waking the camera"}
            </p>
            <p className="mx-auto mt-2 max-w-sm text-sm text-muted">
              {error ??
                (status === "model"
                  ? "First load pulls a 5 MB pose model. It is cached after this."
                  : "Your browser will ask for camera access. The video never leaves this device.")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** Everything real-time is painted here rather than re-rendered through React. */
function draw(
  canvas: HTMLCanvasElement,
  video: { videoWidth: number; videoHeight: number },
  image: { x: number; y: number; visibility?: number }[] | null,
  frame: { elbow: number; elbowSmooth: number; bodyLine: number; depthPct: number; tracked: boolean; phase: string },
  cfg: { bottomAngle: number; bodyLineMin: number },
  armed: boolean,
) {
  const vw = video.videoWidth || 960;
  const vh = video.videoHeight || 540;
  if (canvas.width !== vw || canvas.height !== vh) {
    canvas.width = vw;
    canvas.height = vh;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, vw, vh);

  const bodyOk = frame.bodyLine >= cfg.bodyLineMin;
  const deep = frame.elbow <= cfg.bottomAngle;
  const stroke = !frame.tracked ? "#4a5568" : !bodyOk ? "#ff4767" : deep ? "#24e07f" : "#8aa0c0";

  if (image) {
    ctx.lineWidth = Math.max(3, vw / 220);
    ctx.strokeStyle = stroke;
    ctx.lineCap = "round";
    ctx.globalAlpha = frame.tracked ? 0.95 : 0.4;

    for (const [a, b] of SKELETON) {
      const p = image[a];
      const q = image[b];
      if (!p || !q) continue;
      if ((p.visibility ?? 1) < 0.35 || (q.visibility ?? 1) < 0.35) continue;
      ctx.beginPath();
      ctx.moveTo(p.x * vw, p.y * vh);
      ctx.lineTo(q.x * vw, q.y * vh);
      ctx.stroke();
    }

    ctx.fillStyle = stroke;
    for (const i of [L.L_SHOULDER, L.R_SHOULDER, L.L_ELBOW, L.R_ELBOW, L.L_WRIST, L.R_WRIST, L.L_HIP, L.R_HIP]) {
      const p = image[i];
      if (!p || (p.visibility ?? 1) < 0.35) continue;
      ctx.beginPath();
      ctx.arc(p.x * vw, p.y * vh, Math.max(4, vw / 190), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  if (!armed) return;

  // Depth gauge. Mirrored with the video, so it is drawn on the right of the
  // canvas to end up on the viewer's left.
  const gw = Math.max(14, vw / 60);
  const gh = vh * 0.5;
  const gx = vw - gw * 3;
  const gy = (vh - gh) / 2;

  ctx.fillStyle = "rgba(6,8,14,0.55)";
  ctx.beginPath();
  ctx.roundRect(gx, gy, gw, gh, gw / 2);
  ctx.fill();

  const fill = Math.min(1, Math.max(0, frame.depthPct));
  ctx.fillStyle = deep ? "#24e07f" : "#f0b429";
  ctx.beginPath();
  ctx.roundRect(gx, gy + gh * (1 - fill), gw, gh * fill, gw / 2);
  ctx.fill();

  // The line you have to break for the rep to count.
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 2;
  ctx.setLineDash([5, 4]);
  ctx.beginPath();
  ctx.moveTo(gx - gw * 0.5, gy + 2);
  ctx.lineTo(gx + gw * 1.5, gy + 2);
  ctx.stroke();
  ctx.setLineDash([]);

  if (!bodyOk && frame.tracked) {
    ctx.save();
    ctx.scale(-1, 1); // undo the mirror so text reads correctly
    ctx.fillStyle = "#ff4767";
    ctx.font = `700 ${Math.round(vw / 26)}px "Arial Narrow", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText("STRAIGHTEN UP", -vw / 2, vh - vh / 12);
    ctx.restore();
  }
}

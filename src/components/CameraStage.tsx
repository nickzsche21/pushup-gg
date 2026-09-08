"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SKELETON, detect, loadLandmarker } from "@/lib/pose/landmarker";
import { L } from "@/lib/pose/geometry";
import type { CounterConfig, Frame, NoRepEvent, RepEvent } from "@/lib/pose/repCounter";
import { RepCounter } from "@/lib/pose/repCounter";
import { SimulatedAthlete } from "@/lib/pose/simulator";
import { FramingStabiliser, analyseFraming, type Framing } from "@/lib/coach/framing";

export type StageStatus = "idle" | "camera" | "model" | "ready" | "error";

interface Props {
  config: CounterConfig;
  /** When true, reps count. Flipping it on resets the counter. */
  armed: boolean;
  onRep?: (r: RepEvent) => void;
  onNoRep?: (n: NoRepEvent) => void;
  onStatus?: (s: StageStatus, message?: string) => void;
  /** Fires when the athlete has held a plank long enough to start. */
  onInPosition?: (ready: boolean) => void;
  /** Camera setup verdict, while not armed. */
  onFraming?: (f: Framing) => void;
  /** A live form fault worth saying out loud mid-set. */
  onFault?: (fault: "hips" | "flare" | null) => void;
  /**
   * Demo mode: drive the referee from a simulated athlete instead of a camera.
   * Same counter, same gates, same overlay — only the landmark source changes,
   * so it is also how the match flow gets exercised in tests.
   */
  simulate?: boolean;
}

export default function CameraStage({
  config,
  armed,
  onRep,
  onNoRep,
  onStatus,
  onInPosition,
  onFraming,
  onFault,
  simulate,
}: Props) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const counterRef = useRef<RepCounter | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef(-1);
  const armedRef = useRef(armed);
  const positionRef = useRef(false);
  const faultRef = useRef<"hips" | "flare" | null>(null);

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
  const cbRef = useRef({ onRep, onNoRep, onInPosition, onFraming, onFault });
  cbRef.current = { onRep, onNoRep, onInPosition, onFraming, onFault };

  // The config is read every frame, so keep it current without restarting the
  // camera — changing variation mid-setup should not drop the video stream.
  const cfgRef = useRef(config);
  cfgRef.current = config;

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
      cfgRef.current,
      (r) => armedRef.current && cbRef.current.onRep?.(r),
      (n) => armedRef.current && cbRef.current.onNoRep?.(n),
    );
    counterRef.current = counter;
    const framing = new FramingStabiliser(700);

    /** Shared by the camera and demo paths — everything after the landmarks. */
    const consume = (world: Parameters<RepCounter["update"]>[0], image: Parameters<RepCounter["update"]>[1], ts: number) => {
      const cfg = cfgRef.current;
      const frame = counter.update(world, image, ts);

      if (!armedRef.current) {
        const verdict = framing.push(analyseFraming(image, cfg.bodyLineJoint), ts);
        cbRef.current.onFraming?.(verdict);

        const ready = verdict.issue === "ok" && counter.readyFor(1200, ts);
        if (ready !== positionRef.current) {
          positionRef.current = ready;
          cbRef.current.onInPosition?.(ready);
        }
      } else {
        // Only shout about a fault while it is actually happening.
        const fault =
          frame.tracked && frame.phase !== "top" && frame.bodyLine < cfg.bodyLineMin
            ? "hips"
            : frame.tracked && frame.phase !== "top" && frame.flare > cfg.maxFlare
              ? "flare"
              : null;
        if (fault !== faultRef.current) {
          faultRef.current = fault;
          cbRef.current.onFault?.(fault);
        }
      }

      const c = canvasRef.current;
      const v = videoRef.current;
      const dims = simulate
        ? { videoWidth: 960, videoHeight: 540 }
        : { videoWidth: v?.videoWidth || 960, videoHeight: v?.videoHeight || 540 };
      if (c) draw(c, dims, image, frame, cfg, armedRef.current);

      if (simulate) {
        // Demo mode exposes the referee's view for threshold tuning.
        (window as unknown as { __pug?: unknown }).__pug = {
          ...frame,
          reps: counter.count,
          noReps: counter.noReps.length,
        };
      }
    };

    if (simulate) {
      const athlete = new SimulatedAthlete();
      push("ready");
      const loop = () => {
        rafRef.current = requestAnimationFrame(loop);
        const ts = performance.now();
        if (ts <= lastTsRef.current) return;
        lastTsRef.current = ts;
        const { world, image } = athlete.sample(ts);
        consume(world, image, ts);
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
          if (!v || v.readyState < 2) return;

          // MediaPipe's VIDEO mode rejects a timestamp it has already seen.
          const ts = performance.now();
          if (ts <= lastTsRef.current) return;
          lastTsRef.current = ts;

          try {
            const r = detect(lm, v, ts);
            consume(r.world, r.image, ts);
          } catch {
            // A dropped frame is not worth tearing the loop down.
          }
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
      // Release the camera on the way out. Leaving the indicator light on
      // after a set is the single most-reported complaint about apps like this.
      stream?.getTracks().forEach((t) => t.stop());
      const v = videoRef.current;
      if (v) v.srcObject = null;
    };
  }, [push, simulate]);

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
  frame: Frame,
  cfg: CounterConfig,
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
  const flareOk = frame.flare <= cfg.maxFlare;
  const deep = frame.elbow <= cfg.bottomAngle;
  const stroke = !frame.tracked ? "#4a5568" : !bodyOk ? "#ff4767" : !flareOk ? "#f0b429" : deep ? "#24e07f" : "#8aa0c0";

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

  const shout = !frame.tracked ? null : !bodyOk ? "STRAIGHTEN UP" : !flareOk ? "ELBOWS IN" : null;
  if (shout) {
    ctx.save();
    ctx.scale(-1, 1); // undo the mirror so text reads correctly
    ctx.fillStyle = bodyOk ? "#f0b429" : "#ff4767";
    ctx.font = `700 ${Math.round(vw / 26)}px "Arial Narrow", system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(shout, -vw / 2, vh - vh / 12);
    ctx.restore();
  }
}

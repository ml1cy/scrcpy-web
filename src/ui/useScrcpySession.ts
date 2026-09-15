import { useCallback, useEffect, useRef, useState } from "react";

import type { ScrcpySession } from "../server/launch";
import { launchServer } from "../server/launch";
import { pushServer } from "../server/push";
import type { Transport } from "../transport/types";
import type { WorkerEvent, WorkerRequest } from "../video/worker";

export interface StreamStats {
  frames: number;
  packets: number;
  bytes: number;
  skipped: number;
}

export interface VideoInfo {
  codec: string;
  width: number;
  height: number;
  audioCodec: string | undefined;
}

export type SessionState =
  | { kind: "idle" }
  | { kind: "starting"; step: string }
  | {
      kind: "streaming";
      video: VideoInfo | undefined;
      stats: StreamStats;
      audioCodec: string | undefined;
      warning: string | undefined;
    }
  | { kind: "error"; message: string };

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useScrcpySession(transport: Transport | null) {
  const [state, setState] = useState<SessionState>({ kind: "idle" });
  const sessionRef = useRef<ScrcpySession | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // transferControlToOffscreen throws if called twice on the same element, so
  // each session remounts the canvas under a fresh key.
  const [canvasKey, setCanvasKey] = useState(0);

  const teardown = useCallback(() => {
    workerRef.current?.postMessage({ type: "stop" } satisfies WorkerRequest);
    workerRef.current?.terminate();
    workerRef.current = null;
    setCanvasKey((key) => key + 1);
    const session = sessionRef.current;
    sessionRef.current = null;
    return session?.close();
  }, []);

  const stop = useCallback(async () => {
    const closing = teardown();
    setState({ kind: "idle" });
    await closing;
  }, [teardown]);

  // A live session holds the device's screen capture open, so it must not
  // outlive the component that started it.
  useEffect(() => {
    return () => {
      void teardown();
    };
  }, [teardown]);

  const start = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!transport || sessionRef.current) {
      return;
    }
    if (!canvas) {
      // Silently doing nothing here is how a broken start looks like a dead
      // button, so say so instead.
      setState({
        kind: "error",
        message: "Video canvas is not ready yet — try again in a moment.",
      });
      return;
    }
    try {
      setState({ kind: "starting", step: "Pushing server to device…" });
      await pushServer(transport);

      setState({ kind: "starting", step: "Launching server…" });
      const session = await launchServer(transport);
      sessionRef.current = session;

      const worker = new Worker(
        new URL("../video/worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current = worker;

      setState({
        kind: "streaming",
        video: undefined,
        stats: { frames: 0, packets: 0, bytes: 0, skipped: 0 },
        audioCodec: session.audio?.codec.mimeType,
        warning: undefined,
      });

      worker.onmessage = (event: MessageEvent<WorkerEvent>) => {
        const data = event.data;
        switch (data.type) {
          case "config":
            console.info(
              `[scrcpy] video config: ${data.codec} ${String(data.width)}x${String(data.height)}`,
            );
            setState((current) =>
              current.kind === "streaming"
                ? {
                    ...current,
                    video: {
                      codec: data.codec,
                      width: data.width,
                      height: data.height,
                      audioCodec: current.audioCodec,
                    },
                  }
                : current,
            );
            break;
          case "size":
            setState((current) =>
              current.kind === "streaming" && current.video
                ? {
                    ...current,
                    video: {
                      ...current.video,
                      width: data.width,
                      height: data.height,
                    },
                  }
                : current,
            );
            break;
          case "stats":
            setState((current) =>
              current.kind === "streaming"
                ? {
                    ...current,
                    stats: {
                      frames: data.frames,
                      packets: data.packets,
                      bytes: data.bytes,
                      skipped: data.skipped,
                    },
                  }
                : current,
            );
            break;
          case "warning":
            console.warn(`[scrcpy] ${data.message}`);
            setState((current) =>
              current.kind === "streaming"
                ? { ...current, warning: data.message }
                : current,
            );
            break;
          case "ended":
            break;
          case "error":
            setState({ kind: "error", message: data.message });
            break;
        }
      };

      const offscreen = canvas.transferControlToOffscreen();
      const request: WorkerRequest = {
        type: "start",
        canvas: offscreen,
        packets: session.video.packets,
      };
      // Both the canvas and the packet stream are transferred, so decoding and
      // drawing never touch the main thread.
      worker.postMessage(request, [offscreen, session.video.packets]);

      void session.exited.then((output) => {
        void teardown();
        setState({
          kind: "error",
          message: output.trim() || "Server exited unexpectedly",
        });
      });
    } catch (error) {
      void teardown();
      setState({ kind: "error", message: message(error) });
    }
  }, [transport, teardown]);

  return { state, start, stop, canvasRef, canvasKey };
}

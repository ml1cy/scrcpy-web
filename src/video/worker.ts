/// <reference lib="webworker" />
import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import type { ReadableStream } from "@yume-chan/stream-extra";
import { WritableStream } from "@yume-chan/stream-extra";

import { WebCodecsVideoDecoder } from "./decoder-webcodecs";
import { CanvasRenderer } from "./renderer";

export interface StartMessage {
  type: "start";
  canvas: OffscreenCanvas;
  packets: ReadableStream<ScrcpyMediaStreamPacket>;
}

export type WorkerRequest = StartMessage | { type: "stop" };

export type WorkerEvent =
  | { type: "config"; codec: string; width: number; height: number }
  | { type: "size"; width: number; height: number }
  | {
      type: "stats";
      frames: number;
      packets: number;
      bytes: number;
      skipped: number;
    }
  | { type: "warning"; message: string }
  | { type: "ended" }
  | { type: "error"; message: string };

const STATS_INTERVAL_MS = 400;

const scope = self as unknown as DedicatedWorkerGlobalScope;

let decoder: WebCodecsVideoDecoder | undefined;
let statsTimer: ReturnType<typeof setInterval> | undefined;

function post(event: WorkerEvent): void {
  scope.postMessage(event);
}

function stop(): void {
  if (statsTimer !== undefined) {
    clearInterval(statsTimer);
    statsTimer = undefined;
  }
  decoder?.close();
  decoder = undefined;
}

function start(message: StartMessage): void {
  const counters = { frames: 0, packets: 0, bytes: 0 };

  const renderer = new CanvasRenderer(message.canvas, (width, height) => {
    // M4's input layer needs the displayed size on the same tick as the
    // resize, or taps land in the wrong place after a rotation.
    post({ type: "size", width, height });
  });

  const countingSink = {
    draw(frame: VideoFrame) {
      counters.frames += 1;
      renderer.draw(frame);
    },
    close() {
      renderer.close();
    },
  };

  decoder = new WebCodecsVideoDecoder(countingSink, {
    onConfig: (config) => {
      post({
        type: "config",
        codec: config.codec,
        width: config.croppedWidth,
        height: config.croppedHeight,
      });
    },
    onDecodeError: (error) => {
      // Recoverable: the decoder resyncs on the next keyframe.
      post({ type: "warning", message: error.message });
    },
    onError: (error) => {
      post({ type: "error", message: error.message });
    },
  });

  const snapshot = () => ({
    ...counters,
    skipped: decoder?.skipped ?? 0,
  });

  statsTimer = setInterval(() => {
    post({ type: "stats", ...snapshot() });
  }, STATS_INTERVAL_MS);

  message.packets
    .pipeTo(
      new WritableStream<ScrcpyMediaStreamPacket>({
        write(packet) {
          counters.packets += 1;
          counters.bytes += packet.data.length;
          try {
            decoder?.handle(packet);
          } catch (error) {
            // Never let one bad packet reject the pipe and end the session.
            post({
              type: "warning",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    )
    .then(
      () => {
        post({ type: "stats", ...snapshot() });
        post({ type: "ended" });
        stop();
      },
      (error: unknown) => {
        post({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
        stop();
      },
    );
}

scope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "start") {
    start(event.data);
  } else {
    stop();
  }
};

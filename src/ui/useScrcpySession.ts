import { WritableStream } from "@yume-chan/stream-extra";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ScrcpySession } from "../server/launch";
import { launchServer } from "../server/launch";
import { pushServer } from "../server/push";
import type { Transport } from "../transport/types";

export interface StreamStats {
  packets: number;
  bytes: number;
  keyframes: number;
  firstPacketBytes: number | undefined;
}

export interface VideoInfo {
  codec: number;
  codecName: string;
  width: number | undefined;
  height: number | undefined;
  audioCodec: string | undefined;
}

export type SessionState =
  | { kind: "idle" }
  | { kind: "starting"; step: string }
  | { kind: "streaming"; video: VideoInfo; stats: StreamStats }
  | { kind: "error"; message: string };

const CODEC_NAMES = new Map<number, string>([
  [0x68_32_36_34, "H.264"],
  [0x68_32_36_35, "H.265"],
  [0x00_61_76_31, "AV1"],
]);

// Counters update per packet, which is far faster than anything worth
// rendering. They accumulate in a ref and flush on this interval instead.
const STATS_FLUSH_MS = 400;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useScrcpySession(transport: Transport | null) {
  const [state, setState] = useState<SessionState>({ kind: "idle" });
  const sessionRef = useRef<ScrcpySession | null>(null);

  const stop = useCallback(async () => {
    const session = sessionRef.current;
    sessionRef.current = null;
    setState({ kind: "idle" });
    await session?.close();
  }, []);

  // A live session holds the device's screen capture open, so it must not
  // outlive the component that started it.
  useEffect(() => {
    return () => {
      void sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
    if (!transport || sessionRef.current) {
      return;
    }
    try {
      setState({ kind: "starting", step: "Pushing server to device…" });
      await pushServer(transport);

      setState({ kind: "starting", step: "Launching server…" });
      const session = await launchServer(transport);
      sessionRef.current = session;

      const { metadata } = session.video;
      const video: VideoInfo = {
        codec: metadata.codec,
        codecName: CODEC_NAMES.get(metadata.codec) ?? `0x${metadata.codec.toString(16)}`,
        width: metadata.width,
        height: metadata.height,
        audioCodec: session.audio?.codec.mimeType,
      };

      const stats: StreamStats = {
        packets: 0,
        bytes: 0,
        keyframes: 0,
        firstPacketBytes: undefined,
      };
      setState({ kind: "streaming", video, stats: { ...stats } });

      const flush = setInterval(() => {
        setState((current) =>
          current.kind === "streaming"
            ? { ...current, stats: { ...stats } }
            : current,
        );
      }, STATS_FLUSH_MS);

      // M2 only proves the stream is alive; decoding arrives with M3.
      void session.video.packets
        .pipeTo(
          new WritableStream({
            write(packet) {
              stats.packets += 1;
              stats.bytes += packet.data.length;
              if (packet.type === "data" && packet.keyframe === true) {
                stats.keyframes += 1;
              }
              if (stats.firstPacketBytes === undefined) {
                stats.firstPacketBytes = packet.data.length;
                console.info(
                  `[scrcpy] first video packet: ${String(packet.data.length)} bytes, ` +
                    `codec id 0x${metadata.codec.toString(16)} (${video.codecName}), ` +
                    `${String(metadata.width)}x${String(metadata.height)}`,
                );
              }
            },
          }),
        )
        .catch((error: unknown) => {
          setState({ kind: "error", message: message(error) });
        })
        .finally(() => {
          clearInterval(flush);
        });

      void session.exited.then((output) => {
        clearInterval(flush);
        sessionRef.current = null;
        setState({
          kind: "error",
          message: output.trim() || "Server exited unexpectedly",
        });
      });
    } catch (error) {
      sessionRef.current = null;
      setState({ kind: "error", message: message(error) });
    }
  }, [transport]);

  return { state, start, stop };
}

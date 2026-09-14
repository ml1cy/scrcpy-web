import { ScrcpyOptions3_3_3 } from "@yume-chan/scrcpy";
import type {
  ScrcpyAudioCodec,
  ScrcpyMediaStreamPacket,
  ScrcpyVideoStreamMetadata,
} from "@yume-chan/scrcpy";
import { ReadableStream, WritableStream } from "@yume-chan/stream-extra";

import {
  DEFAULT_MAX_SIZE,
  DEFAULT_VIDEO_BIT_RATE,
  SCRCPY_SERVER_DEVICE_PATH,
  SCRCPY_SERVER_VERSION,
} from "../constants";
import type { DeviceSocket, Transport } from "../transport/types";

const SOCKET_RETRY_LIMIT = 100;
const SOCKET_RETRY_DELAY_MS = 100;

export interface ScrcpySession {
  readonly video: {
    readonly metadata: ScrcpyVideoStreamMetadata;
    readonly packets: ReadableStream<ScrcpyMediaStreamPacket>;
  };
  readonly audio:
    | { readonly codec: ScrcpyAudioCodec; readonly stream: ReadableStream<Uint8Array> }
    | undefined;
  readonly control: DeviceSocket;
  /** Resolves with the server's output if it exits on its own. */
  readonly exited: Promise<string>;
  close(): Promise<void>;
}

export class ScrcpyServerExitedError extends Error {
  readonly output: string;

  constructor(output: string) {
    super(
      output.trim().length > 0
        ? `scrcpy server exited: ${output.trim()}`
        : "scrcpy server exited without output",
    );
    this.name = "ScrcpyServerExitedError";
    this.output = output;
  }
}

/**
 * Builds the `app_process` invocation. CLASSPATH is passed as a leading
 * environment assignment rather than `-cp`, matching what the scrcpy client
 * itself does (app/src/server.c, scrcpy 3.3.3).
 */
export function buildServerCommand(
  serverPath: string,
  version: string,
  serializedOptions: readonly string[],
): string[] {
  return [
    `CLASSPATH=${serverPath}`,
    "app_process",
    "/",
    "com.genymobile.scrcpy.Server",
    version,
    ...serializedOptions,
  ];
}

/**
 * Re-emits `prefix`, then everything left in `rest`. Used to put back the bytes
 * that came along with the forward-tunnel dummy byte in the same chunk.
 */
export function prepend(
  prefix: Uint8Array,
  rest: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const reader = rest.getReader();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (prefix.length > 0) {
        controller.enqueue(prefix);
      }
    },
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
      } else {
        controller.enqueue(value);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * In forward-tunnel mode the socket connects instantly even before the server
 * is listening, so the server writes one dummy byte to mark a real connection.
 * Only the first socket of a session carries it.
 */
async function consumeDummyByte(socket: DeviceSocket): Promise<DeviceSocket> {
  const reader = socket.readable.getReader();
  let chunk = await reader.read();
  while (!chunk.done && chunk.value.length === 0) {
    chunk = await reader.read();
  }
  if (chunk.done) {
    reader.releaseLock();
    throw new Error("Server closed the socket before sending the dummy byte");
  }
  const remainder = chunk.value.subarray(1);
  reader.releaseLock();
  return {
    readable: prepend(remainder, socket.readable),
    writable: socket.writable,
    close: () => socket.close(),
  };
}

async function connectWithRetry(
  transport: Transport,
  service: string,
): Promise<DeviceSocket> {
  for (let attempt = 0; attempt < SOCKET_RETRY_LIMIT; attempt += 1) {
    try {
      return await transport.openSocket(service);
    } catch {
      // The server may still be starting up.
      await delay(SOCKET_RETRY_DELAY_MS);
    }
  }
  throw new Error(
    `Could not connect to ${service} after ${String(SOCKET_RETRY_LIMIT)} attempts`,
  );
}

function collectOutput(
  output: ReadableStream<Uint8Array>,
  onChunk: (text: string) => void,
): Promise<void> {
  // The ADB connection is multiplexed: leaving the process output unread
  // blocks every other socket, so this must run for the process's lifetime.
  return output.pipeTo(
    new WritableStream({
      write(chunk) {
        onChunk(new TextDecoder().decode(chunk));
      },
    }),
  );
}

export interface LaunchOptions {
  maxSize?: number;
  videoBitRate?: number;
}

export async function launchServer(
  transport: Transport,
  launchOptions: LaunchOptions = {},
): Promise<ScrcpySession> {
  const options = new ScrcpyOptions3_3_3({
    // Forward tunnel: the device listens and we connect, so our side never has
    // to act as a host. See §6 of CLAUDE.md.
    tunnelForward: true,
    video: true,
    audio: true,
    control: true,
    videoCodec: "h264",
    maxSize: launchOptions.maxSize ?? DEFAULT_MAX_SIZE,
    videoBitRate: launchOptions.videoBitRate ?? DEFAULT_VIDEO_BIT_RATE,
    // Leave the screen on; the server tears itself down when the sockets close.
    cleanup: true,
  });

  const scid = options.value.scid;
  const suffix =
    typeof scid === "string" && scid.length > 0
      ? `_${scid.padStart(8, "0")}`
      : "";
  const service = `localabstract:scrcpy${suffix}`;

  const command = buildServerCommand(
    SCRCPY_SERVER_DEVICE_PATH,
    SCRCPY_SERVER_VERSION,
    options.serialize(),
  );

  const process = await transport.spawn(command);

  let output = "";
  const draining = collectOutput(process.output, (text) => {
    output += text;
  }).catch(() => {
    // The process going away closes this stream; the exit path reports it.
  });

  const exitedWithOutput = process.exited.then(async () => {
    await draining;
    return output;
  });

  try {
    const sockets = await Promise.race([
      exitedWithOutput.then((text) => {
        throw new ScrcpyServerExitedError(text);
      }),
      (async () => {
        // Order matters: video, then audio, then control, or the server hangs.
        const video = await consumeDummyByte(
          await connectWithRetry(transport, service),
        );
        const audio = await connectWithRetry(transport, service);
        const control = await connectWithRetry(transport, service);
        return { video, audio, control };
      })(),
    ]);

    const videoStream = await options.parseVideoStreamMetadata(
      sockets.video.readable,
    );
    const audioMetadata = await options.parseAudioStreamMetadata?.(
      sockets.audio.readable,
    );

    return {
      video: {
        metadata: videoStream.metadata,
        packets: videoStream.stream.pipeThrough(
          options.createMediaStreamTransformer(),
        ),
      },
      audio:
        audioMetadata?.type === "success"
          ? { codec: audioMetadata.codec, stream: audioMetadata.stream }
          : undefined,
      control: sockets.control,
      exited: exitedWithOutput,
      close: async () => {
        await process.kill();
      },
    };
  } catch (error) {
    await process.kill();
    throw error;
  }
}

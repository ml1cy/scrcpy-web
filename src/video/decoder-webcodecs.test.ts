import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebCodecsVideoDecoder } from "./decoder-webcodecs";
import type { VideoSink } from "./renderer";

// SPS/PPS for baseline 3.0, 320x240 — generated with a bit writer and checked
// against h264ParseConfiguration, so it exercises the real parser.
const CONFIG_DATA = new Uint8Array([
  0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1e, 0xf4, 0x0a, 0x0f, 0xc8, 0, 0, 0, 1, 0x68,
  0xce, 0x38, 0x80,
]);

interface Decoded {
  type: string;
  timestamp: number;
}

let decoded: Decoded[];
let configured: unknown[];
let decodeThrows: Error | undefined;

class StubVideoDecoder {
  state = "unconfigured";
  configure(config: unknown) {
    configured.push(config);
    this.state = "configured";
  }
  decode(chunk: Decoded) {
    if (decodeThrows) {
      throw decodeThrows;
    }
    decoded.push({ type: chunk.type, timestamp: chunk.timestamp });
  }
  close() {
    this.state = "closed";
  }
}

function packet(
  keyframe: boolean | undefined,
  pts: bigint,
): ScrcpyMediaStreamPacket {
  return {
    type: "data",
    keyframe,
    pts,
    data: new Uint8Array([0, 0, 0, 1, 0x41, 1, 2, 3]),
  } as ScrcpyMediaStreamPacket;
}

const sink: VideoSink = { draw: () => undefined, close: () => undefined };

beforeEach(() => {
  decoded = [];
  configured = [];
  decodeThrows = undefined;
  vi.stubGlobal("VideoDecoder", StubVideoDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      type: string;
      timestamp: number;
      constructor(init: { type: string; timestamp: number }) {
        this.type = init.type;
        this.timestamp = init.timestamp;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebCodecsVideoDecoder", () => {
  it("configures from a configuration packet", () => {
    const decoder = new WebCodecsVideoDecoder(sink, { onError: () => undefined });
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    expect(configured).toHaveLength(1);
    expect(decoder.config?.codec).toBe("avc1.42001e");
  });

  // Feeding a delta frame to a freshly configured decoder throws
  // "A key frame is required after configure()", which used to reject the
  // pipe and kill the whole session.
  it("drops delta frames until the first keyframe", () => {
    const decoder = new WebCodecsVideoDecoder(sink, { onError: () => undefined });
    decoder.handle({ type: "configuration", data: CONFIG_DATA });

    decoder.handle(packet(false, 1000n));
    decoder.handle(packet(false, 2000n));
    expect(decoded).toHaveLength(0);
    expect(decoder.skipped).toBe(2);

    decoder.handle(packet(true, 3000n));
    expect(decoded).toEqual([{ type: "key", timestamp: 3000 }]);

    // Once synced, later delta frames go through.
    decoder.handle(packet(false, 4000n));
    expect(decoded).toHaveLength(2);
    expect(decoded[1]).toEqual({ type: "delta", timestamp: 4000 });
  });

  it("reports a decode failure without throwing, then resyncs on a keyframe", () => {
    const errors: Error[] = [];
    const decoder = new WebCodecsVideoDecoder(sink, {
      onDecodeError: (error) => errors.push(error),
      onError: () => undefined,
    });
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 1000n));
    expect(decoded).toHaveLength(1);

    decodeThrows = new Error("bad chunk");
    expect(() => decoder.handle(packet(false, 2000n))).not.toThrow();
    expect(errors.map((e) => e.message)).toEqual(["bad chunk"]);

    // After a failure it waits for a keyframe rather than feeding more deltas.
    decodeThrows = undefined;
    decoder.handle(packet(false, 3000n));
    expect(decoded).toHaveLength(1);
    decoder.handle(packet(true, 4000n));
    expect(decoded).toHaveLength(2);
  });

  it("ignores data packets that arrive before any configuration", () => {
    const decoder = new WebCodecsVideoDecoder(sink, { onError: () => undefined });
    decoder.handle(packet(true, 1000n));
    expect(decoded).toHaveLength(0);
    expect(configured).toHaveLength(0);
  });
});

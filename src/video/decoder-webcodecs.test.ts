import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WebCodecsVideoDecoder } from "./decoder-webcodecs";
import type { VideoSink } from "./renderer";

// SPS/PPS for baseline 3.0, 320x240 — built with a bit writer and checked
// against h264ParseConfiguration, so this exercises the real parser.
const CONFIG_DATA = new Uint8Array([
  0, 0, 0, 1, 0x67, 0x42, 0x00, 0x1e, 0xf4, 0x0a, 0x0f, 0xc8, 0, 0, 0, 1, 0x68,
  0xce, 0x38, 0x80,
]);

const FRAME_DATA = new Uint8Array([0, 0, 0, 1, 0x41, 1, 2, 3]);

interface Decoded {
  type: string;
  timestamp: number;
  data: Uint8Array;
}

let decoded: Decoded[];
let configured: unknown[];
let resets: number;
let decodeThrows: Error | undefined;
let queueSize: number;

class StubVideoDecoder {
  state = "unconfigured";
  get decodeQueueSize() {
    return queueSize;
  }
  configure(config: unknown) {
    configured.push(config);
    this.state = "configured";
  }
  decode(chunk: Decoded) {
    if (decodeThrows) {
      throw decodeThrows;
    }
    decoded.push(chunk);
  }
  reset() {
    resets += 1;
    this.state = "unconfigured";
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
    data: FRAME_DATA,
  } as ScrcpyMediaStreamPacket;
}

const sink: VideoSink = { draw: () => undefined, close: () => undefined };

function chunkAt(index: number): Decoded {
  const chunk = decoded[index];
  if (!chunk) {
    throw new Error(`no decoded chunk at index ${String(index)}`);
  }
  return chunk;
}

function makeDecoder(onDecodeError?: (error: Error) => void) {
  return new WebCodecsVideoDecoder(sink, {
    onDecodeError,
    onError: () => undefined,
  });
}

beforeEach(() => {
  decoded = [];
  configured = [];
  resets = 0;
  queueSize = 0;
  decodeThrows = undefined;
  vi.stubGlobal("VideoDecoder", StubVideoDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      type: string;
      timestamp: number;
      data: Uint8Array;
      constructor(init: Decoded) {
        this.type = init.type;
        this.timestamp = init.timestamp;
        this.data = init.data;
      }
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WebCodecsVideoDecoder", () => {
  it("derives the codec string but does not configure until a keyframe", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    expect(decoder.config?.codec).toBe("avc1.42001e");
    expect(configured).toHaveLength(0);
  });

  // Annex-B decoding needs the parameter sets in the bitstream. Passing only
  // the slice data leaves the decoder consuming chunks and emitting nothing,
  // with no error to show for it.
  it("prepends the SPS/PPS to the first keyframe", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 1000n));

    expect(configured).toEqual([
      { codec: "avc1.42001e", optimizeForLatency: true },
    ]);
    expect(decoded).toHaveLength(1);
    expect(Array.from(chunkAt(0).data)).toEqual([
      ...CONFIG_DATA,
      ...FRAME_DATA,
    ]);
    expect(chunkAt(0).type).toBe("key");
  });

  it("sends later frames without the configuration prefix", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 1000n));
    decoder.handle(packet(false, 2000n));

    expect(decoded).toHaveLength(2);
    expect(Array.from(chunkAt(1).data)).toEqual([...FRAME_DATA]);
    expect(chunkAt(1).type).toBe("delta");
    expect(chunkAt(1).timestamp).toBe(2000);
  });

  it("drops delta frames until the first keyframe arrives", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(false, 1000n));
    decoder.handle(packet(false, 2000n));

    expect(decoded).toHaveLength(0);
    expect(decoder.skipped).toBe(2);
  });

  // scrcpy before 1.23 sends no flag at all; treating that as a keyframe is
  // the only way such a stream ever starts.
  it("treats an absent keyframe flag as a keyframe", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(undefined, 1000n));
    expect(decoded).toHaveLength(1);
    expect(chunkAt(0).type).toBe("key");
  });

  // A rotation sends a fresh SPS, which must be replayed with the keyframe
  // that follows it or the decoder keeps using the old dimensions.
  it("reconfigures and replays the new SPS after a rotation", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 1000n));
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 2000n));

    expect(configured).toHaveLength(2);
    expect(Array.from(chunkAt(1).data)).toEqual([
      ...CONFIG_DATA,
      ...FRAME_DATA,
    ]);
  });

  it("drops a decode backlog at a keyframe to cap latency", () => {
    const decoder = makeDecoder();
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 1000n));
    expect(resets).toBe(0);

    queueSize = 5;
    decoder.handle(packet(true, 2000n));
    expect(resets).toBe(1);
    // Re-configured, and the keyframe carries the parameter sets again.
    expect(configured).toHaveLength(2);
    expect(Array.from(chunkAt(1).data)).toEqual([
      ...CONFIG_DATA,
      ...FRAME_DATA,
    ]);
  });

  it("reports a decode failure without throwing, then resyncs", () => {
    const errors: Error[] = [];
    const decoder = makeDecoder((error) => errors.push(error));
    decoder.handle({ type: "configuration", data: CONFIG_DATA });
    decoder.handle(packet(true, 1000n));

    decodeThrows = new Error("bad chunk");
    expect(() => decoder.handle(packet(false, 2000n))).not.toThrow();
    expect(errors.map((e) => e.message)).toEqual(["bad chunk"]);

    decodeThrows = undefined;
    decoder.handle(packet(false, 3000n));
    expect(decoded).toHaveLength(1);
    decoder.handle(packet(true, 4000n));
    expect(decoded).toHaveLength(2);
  });

  it("counts data packets arriving before any configuration", () => {
    const decoder = makeDecoder();
    decoder.handle(packet(true, 1000n));
    expect(decoded).toHaveLength(0);
    expect(configured).toHaveLength(0);
    expect(decoder.skipped).toBe(1);
  });
});

import { ReadableStream } from "@yume-chan/stream-extra";
import { describe, expect, it } from "vitest";

import { buildServerCommand, prepend } from "./launch";

async function collect(stream: ReadableStream<Uint8Array>): Promise<number[]> {
  const out: number[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    out.push(...value);
  }
  return out;
}

function streamOf(...chunks: number[][]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new Uint8Array(chunk));
      }
      controller.close();
    },
  });
}

describe("buildServerCommand", () => {
  it("passes CLASSPATH as an environment assignment, not -cp", () => {
    const command = buildServerCommand("/data/local/tmp/s.jar", "3.3.3", []);
    expect(command.slice(0, 5)).toEqual([
      "CLASSPATH=/data/local/tmp/s.jar",
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      "3.3.3",
    ]);
  });

  // The version argument must match the jar exactly or the server exits
  // immediately, so it sits ahead of the options and is never reordered.
  it("puts the version before the serialized options", () => {
    const command = buildServerCommand("/p.jar", "3.3.3", [
      "tunnel_forward=true",
      "max_size=1280",
    ]);
    expect(command.indexOf("3.3.3")).toBeLessThan(
      command.indexOf("tunnel_forward=true"),
    );
    expect(command.at(-1)).toBe("max_size=1280");
  });
});

describe("prepend", () => {
  it("emits the prefix before the rest of the stream", async () => {
    const result = await collect(
      prepend(new Uint8Array([1, 2]), streamOf([3, 4], [5])),
    );
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  // The dummy byte usually arrives in the same chunk as real stream data, so
  // the common case is a prefix holding the remainder of that first chunk.
  it("skips an empty prefix", async () => {
    const result = await collect(
      prepend(new Uint8Array([]), streamOf([7, 8], [9])),
    );
    expect(result).toEqual([7, 8, 9]);
  });

  it("propagates an empty rest stream", async () => {
    const result = await collect(prepend(new Uint8Array([42]), streamOf()));
    expect(result).toEqual([42]);
  });
});

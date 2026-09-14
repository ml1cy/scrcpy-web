import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";

import { SCRCPY_SERVER_VERSION } from "./constants";

const JAR_PATH = "public/scrcpy-server.jar";

/**
 * Pulls one deflated entry out of a zip by scanning local file headers. Enough
 * for a jar with a handful of entries, and avoids adding a zip dependency.
 */
function readZipEntry(zip: Buffer, entryName: string): Buffer {
  const LOCAL_HEADER_SIGNATURE = 0x04034b50;
  for (let offset = 0; offset < zip.length - 30; offset++) {
    if (zip.readUInt32LE(offset) !== LOCAL_HEADER_SIGNATURE) {
      continue;
    }
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const name = zip
      .subarray(offset + 30, offset + 30 + nameLength)
      .toString("utf8");
    if (name !== entryName) {
      continue;
    }
    const compressedSize = zip.readUInt32LE(offset + 18);
    const start = offset + 30 + nameLength + extraLength;
    return inflateRawSync(zip.subarray(start, start + compressedSize));
  }
  throw new Error(`${entryName} not found in archive`);
}

describe("SCRCPY_SERVER_VERSION", () => {
  it("is a dotted version string", () => {
    expect(SCRCPY_SERVER_VERSION).toMatch(/^\d+(\.\d+)+$/);
  });
});

// The server exits immediately if the version argument does not match the jar,
// and a build with no jar at all fails only once it is deployed and someone
// clicks connect. Both are cheap to catch here.
describe("vendored scrcpy-server.jar", () => {
  it("ships with the app", () => {
    expect(() => readFileSync(JAR_PATH)).not.toThrow();
  });

  it("is the build matching SCRCPY_SERVER_VERSION", () => {
    const dex = readZipEntry(readFileSync(JAR_PATH), "classes.dex");
    expect(dex.includes(Buffer.from("com/genymobile/scrcpy/Server"))).toBe(
      true,
    );
    expect(dex.includes(Buffer.from(SCRCPY_SERVER_VERSION))).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import { avcCodecString } from "./demux";

describe("avcCodecString", () => {
  // avc1.PPCCLL — each field is exactly two hex digits, so values below 0x10
  // must keep their leading zero or the browser rejects the codec string.
  it("pads each field to two hex digits", () => {
    expect(avcCodecString(0x42, 0x00, 0x1e)).toBe("avc1.42001e");
    expect(avcCodecString(0x4d, 0x40, 0x28)).toBe("avc1.4d4028");
    expect(avcCodecString(0x64, 0x00, 0x33)).toBe("avc1.640033");
  });

  it("keeps leading zeros in single-digit fields", () => {
    expect(avcCodecString(0x01, 0x02, 0x03)).toBe("avc1.010203");
  });

  it("emits lowercase hex", () => {
    const codec = avcCodecString(0xff, 0xab, 0xcd);
    expect(codec).toBe("avc1.ffabcd");
    expect(codec).toBe(codec.toLowerCase());
  });

  // Baseline 3.0 is what a constrained Android encoder typically negotiates,
  // and is the one string the TinyH264 fallback can also handle.
  it("produces the well-known baseline 3.0 string", () => {
    expect(avcCodecString(66, 0, 30)).toBe("avc1.42001e");
  });
});

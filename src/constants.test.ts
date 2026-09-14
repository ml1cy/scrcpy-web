import { describe, expect, it } from "vitest";
import { SCRCPY_SERVER_VERSION } from "./constants";

describe("SCRCPY_SERVER_VERSION", () => {
  it("is a dotted version string", () => {
    expect(SCRCPY_SERVER_VERSION).toMatch(/^\d+(\.\d+)+$/);
  });
});

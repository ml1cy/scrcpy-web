/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// These two buy cross-origin isolation, which SharedArrayBuffer needs — that's
// the TinyH264 WASM fallback (M5), not WebUSB. WebUSB only needs a secure
// context and a user gesture. Production serves the same pair via public/_headers;
// keep the two in sync or the fallback works in dev and dies in prod.
const crossOriginIsolation = {
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Opener-Policy": "same-origin",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
});

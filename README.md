# scrcpy-web

A browser-based [scrcpy](https://github.com/Genymobile/scrcpy) client. Mirrors and controls an Android device from a Chromium tab, with no native client installed.

See `CLAUDE.md` for the full project brief, milestones, and protocol notes.

## Status

M1 — device connection. Connects to an Android device over WebUSB via [Tango](https://github.com/yume-chan/ya-webadb) and reports its model and Android version. Credentials persist, so a reload reconnects without re-authorizing on the phone. Mirroring starts at M2.

## Requirements

- Node.js and [pnpm](https://pnpm.io/)
- A Chromium-based desktop browser (Chrome/Edge) — this project targets WebUSB, which Firefox and Safari do not implement.

## Development

```sh
pnpm install
pnpm dev       # serves the app at http://localhost:5173
pnpm build     # typecheck + production build
pnpm test      # run unit tests (Vitest)
pnpm lint      # run ESLint
```

## Deploying

The app is fully client-side — the build output is static files, and the device connection is browser-to-USB, so it never touches the origin. It deploys to Cloudflare Workers static assets or Cloudflare Pages with no server component.

Connect the repo and use:

| Setting | Value |
|---|---|
| Build command | `pnpm build` |
| Output directory | `dist` |

Or deploy the built directory straight from the CLI, without adding wrangler to this project:

```sh
pnpm build
npx wrangler pages deploy dist
```

Two things make this work, and both are easy to break:

- **`public/_headers`** sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` on every response. These give the page cross-origin isolation, which `SharedArrayBuffer` requires — that is the TinyH264 WASM fallback path, not WebUSB. Cloudflare parses this file; Vite does not, so `pnpm preview` reflects it only because `vite.config.ts` sets the same two headers itself. Keep the two in sync.
- **`public/scrcpy-server.jar`** is committed to the repo, not downloaded at build time, so a clean CI build always has it. It must match `SCRCPY_SERVER_VERSION` in `src/constants.ts` — the server exits immediately on a mismatch. `pnpm test` checks both that the jar is present and that it is the matching build, so a bad pin fails before it ships.

HTTPS is required for WebUSB and Cloudflare provides it. The M6 WebSocket bridge is a separate, locally-run process: a Worker runs in Cloudflare's network and cannot reach a device on your machine or an adb server on `127.0.0.1:5037`.

## Troubleshooting

- **Device not showing up / WebUSB permission errors:** a running local `adb` server (or Android Studio) can hold the USB interface. Run `adb kill-server` before connecting from the browser.
- **Windows:** the ADB USB interface needs the WinUSB driver. Install it with [Zadig](https://zadig.akeo.ie/).
- **`requestDevice()` throws or does nothing:** WebUSB requires a secure context (HTTPS or `localhost`) and must be triggered by a user gesture (a click), not on page load.

## Licensing

scrcpy is licensed under Apache 2.0; [Tango](https://github.com/yume-chan/ya-webadb) is MIT. Both licenses and the scrcpy NOTICE ship with the built app once the corresponding dependencies land (M1+).

# scrcpy-web

A browser-based [scrcpy](https://github.com/Genymobile/scrcpy) client. Mirrors and controls an Android device from a Chromium tab, with no native client installed.

See `CLAUDE.md` for the full project brief, milestones, and protocol notes.

## Status

M0 — skeleton. Vite + TypeScript (strict) + Vitest + ESLint, with a placeholder Connect button. Device connection lands in M1.

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

## Troubleshooting

- **Device not showing up / WebUSB permission errors:** a running local `adb` server (or Android Studio) can hold the USB interface. Run `adb kill-server` before connecting from the browser.
- **Windows:** the ADB USB interface needs the WinUSB driver. Install it with [Zadig](https://zadig.akeo.ie/).
- **`requestDevice()` throws or does nothing:** WebUSB requires a secure context (HTTPS or `localhost`) and must be triggered by a user gesture (a click), not on page load.

## Licensing

scrcpy is licensed under Apache 2.0; [Tango](https://github.com/yume-chan/ya-webadb) is MIT. Both licenses and the scrcpy NOTICE ship with the built app once the corresponding dependencies land (M1+).

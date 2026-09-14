# scrcpy-web

A browser-based scrcpy client. Mirrors and controls an Android device from a Chromium tab, with no native client installed.

This file is the working brief. Read it before starting any task. If something here is wrong or out of date, say so instead of silently working around it.

---

## 1. Goal

Ship a web app that:

1. Connects to an Android device over ADB from the browser.
2. Pushes and launches the scrcpy server on the device.
3. Decodes the H.264 video stream and renders it at low latency.
4. Decodes and plays the device audio stream in sync with video.
5. Sends touch, keyboard, scroll, and clipboard events back to the device.

Target browser: Chromium desktop (Chrome/Edge). Chrome for Android is a nice-to-have, not a requirement.

## 2. Non-goals

Do not build these unless explicitly asked:

- Firefox or Safari support. WebUSB does not exist there and Mozilla has said it won't implement it.
- Multi-device dashboards, session recording, user accounts, or a backend database.
- A generic ADB file manager / package manager UI. One device, one screen, one control channel.
- Re-implementing the scrcpy *server*. We ship Genymobile's jar as-is.

## 3. Fixed decisions

These are settled. Don't relitigate them mid-task; raise a flag and wait if you think one is wrong.

| Area | Decision |
|---|---|
| Language | TypeScript, `strict: true`, no `any` in committed code |
| Build | Vite, pnpm |
| UI | Minimal — vanilla TS modules plus a thin React shell for the connect/settings panel. No component library. |
| ADB layer | Tango (`@yume-chan/adb`, `@yume-chan/adb-daemon-webusb`, `@yume-chan/adb-credential-web`) |
| scrcpy layer | `@yume-chan/scrcpy` + `@yume-chan/adb-scrcpy` for options/codecs, our own render and input layer on top |
| Primary decoder | WebCodecs `VideoDecoder` |
| Fallback decoder | `@yume-chan/scrcpy-decoder-tinyh264` (WASM, baseline profile only) |
| Transport | WebUSB first. A WebSocket bridge is milestone M6, behind the same interface. |
| Server version | Pinned in `src/constants.ts` as `SCRCPY_SERVER_VERSION`. Never hardcode it anywhere else. |

**Why Tango:** it is an MIT-licensed TypeScript reimplementation of the ADB client that already handles the daemon packet layer, the sync protocol, and the ADB RSA auth handshake. Reimplementing that is weeks of work and is not the point of this project. Treat Tango as a dependency, not as code to fork or patch. If you hit a Tango bug, work around it locally and open a note in `NOTES.md` — do not vendor the package.

## 4. Repo layout

```
src/
  constants.ts        # server version, default options, codec ids
  transport/
    types.ts          # Transport interface — open a named socket, push a file
    webusb.ts         # Tango + WebUSB implementation
    websocket.ts      # M6
  server/
    push.ts           # push scrcpy-server.jar to /data/local/tmp
    launch.ts         # app_process command construction + arg serialization
  video/
    demux.ts          # stream header, codec metadata, frame headers
    decoder-webcodecs.ts
    decoder-tinyh264.ts
    renderer.ts       # VideoFrame -> canvas
  audio/
    demux.ts          # codec metadata, packet headers
    player.ts         # AudioDecoder -> WebAudio
  control/
    messages.ts       # binary encoders for each control message type
    pointer.ts        # PointerEvent -> touch message
    keyboard.ts       # KeyboardEvent.code -> Android keycode
  ui/
public/
  scrcpy-server.jar   # vendored, version must match SCRCPY_SERVER_VERSION
```

Rules: `video/`, `audio/`, and `control/` must not import from `transport/` or Tango. They take streams in and produce bytes out, so they stay unit-testable in Node without a device.

## 5. Milestones

Work one milestone at a time. Each one ends with a working, demoable state. Don't start the next until the acceptance criteria pass on real hardware.

### M0 — Skeleton
Vite project, TypeScript strict, lint, Vitest. A page with a Connect button.
**Done when:** `pnpm dev` serves a page, `pnpm test` and `pnpm lint` pass with zero output.

### M1 — Device connection
`requestDevice()` filtered to the ADB interface (class `0xFF`, subclass `0x42`, protocol `0x01`), connect through Tango, persist credentials via `@yume-chan/adb-credential-web`.
**Done when:** the UI shows the device model and Android version from a `getprop` shell call, and a page reload reconnects without a new phone-side authorization prompt.

### M2 — Server bootstrap
Push the jar to `/data/local/tmp/scrcpy-server.jar`, launch via `app_process`, open the video, audio, and control sockets in forward-tunnel mode — in that order (see §6).
**Done when:** the first packet arrives on the video socket and its size and codec id are logged, and all three sockets open without the server hanging. Killing the tab kills the server process on the device (verify with `ps -A | grep app_process`).

### M3 — Video
Demux, decode with WebCodecs, render to canvas.
**Done when:** the device screen is visible, rotation is handled, and a 60-second session shows no growing memory and no decoder stall. Measure glass-to-glass latency against a stopwatch app; log the number in `NOTES.md`.

### M3.5 — Audio
Demux the audio stream, decode it, and play it. Codec is negotiated with the server (Opus by default on 3.x); decode with WebCodecs `AudioDecoder` and play through WebAudio.
**Done when:** audio plays in sync with video for a 60-second session, with no buffer underruns and no growing latency. Log the A/V offset in `NOTES.md`.

### M4 — Input
Pointer, keyboard, scroll, back/home/app-switch buttons.
**Done when:** you can unlock the device, type into a text field, scroll a list, and drag a home screen icon, all from the browser.

### M5 — Polish
Clipboard sync both ways, screen-off-while-mirroring, resolution and bitrate settings, graceful reconnect on cable pull, TinyH264 fallback when `VideoDecoder` is unavailable.

### M6 — WebSocket transport
A small Node bridge implementing the same `Transport` interface, so the app runs against remote devices without WebUSB.

## 6. Protocol reference

Verify all of this against the pinned server version's source before trusting it. The layouts change between scrcpy majors.

**Launch command**

```
CLASSPATH=/data/local/tmp/scrcpy-server.jar app_process / \
  com.genymobile.scrcpy.Server <VERSION> tunnel_forward=true video_codec=h264 max_size=1280 ...
```

The version argument must match the jar exactly or the server exits immediately. Options are `key=value` pairs in scrcpy 2.0 and later.

**Tunnel mode.** Use `tunnel_forward=true`: the device listens on `localabstract:scrcpy_<scid>` and we open it. In forward mode the server writes one dummy `0x00` byte before the stream so the client can tell a real connection from a dead server. Reverse tunnels would make our JS the listening host — more moving parts, no benefit here.

**Socket order.** Video, then audio (if enabled), then control. Open them in that order or the server hangs.

**Video stream framing**
- 64-byte device name (unless `send_device_meta=false`)
- codec metadata: codec id (u32), width (u32), height (u32)
- then per packet: PTS (u64, with config and keyframe flags packed into the high bits), length (u32), payload

Config packets carry SPS/PPS and must be used to build the `VideoDecoder` codec string (`avc1.PPCCLL` from the SPS profile, constraint flags, and level). Chromium accepts Annex-B payloads directly when `description` is omitted from the decoder config.

**Control messages.** Binary, big-endian, leading type byte. Touch (type `2`) is: action (u8), pointer id (u64), x (i32), y (i32), screen width (u16), screen height (u16), pressure (u16 fixed-point), action button (u32), buttons (u32). The screen dimensions in every message are the dimensions the coordinates were computed against — get this wrong and taps land in the wrong place after a rotation.

## 7. Pitfalls

Each of these has cost someone a day. Check them first when something breaks.

- **A local `adb` server steals the USB interface.** `adb kill-server` before connecting. On Windows the ADB interface needs the WinUSB driver (Zadig). Put this in the README's troubleshooting section, not just here.
- **`VideoFrame` must be `close()`d** immediately after drawing. Skip it and the decoder stalls within seconds. This is the single most likely cause of "video freezes after a moment".
- **WebUSB needs a secure context and a user gesture** for `requestDevice()`. It won't work from a non-localhost HTTP origin.
- **Bulk transfers are not packet-aligned.** Never assume one `transferIn` equals one ADB packet. Buffer and frame properly.
- **Don't block the main thread.** Demux and decode belong in a worker, with transferable streams between stages.
- **Rotation changes the stream dimensions mid-session.** The decoder needs reconfiguring and the input layer needs the new dimensions on the same tick.
- **`prefers-reduced-motion` and background tabs** throttle rAF. Drive rendering off decoder output, not off a render loop.

## 8. How to work in this repo

- Small commits, one concern each, imperative subject lines.
- **No new dependencies without asking.** The dependency list above is the budget.
- Unit tests for everything in `video/`, `audio/`, and `control/` — these are pure byte manipulation and there's no excuse. Fixtures go in `test/fixtures/` as captured hex dumps.
- No device-dependent logic in tests. If it needs hardware, it's a manual check in the milestone criteria instead.
- When you change anything protocol-related, cite the scrcpy source file and version you checked in the commit message.
- Log latency and memory numbers in `NOTES.md` as you go. Regressions here are the main thing that can quietly kill this project.
- If a milestone's acceptance criteria can't be met, stop and report. Don't lower the bar and continue.

## 9. Licensing

scrcpy is Apache 2.0 and Tango is MIT. Both licenses and the scrcpy NOTICE must ship with the built app. Attribution goes in the README and in an about panel in the UI. The vendored jar is redistributed unmodified.

## 10. Open questions

Answer these with me before they block you — don't guess:

- Whether the WebSocket bridge (M6) should talk to a local `adb` server on port 5037 or to the device directly over `adb tcpip`.

### Resolved

- **Server version: pin `3.3.3`** (2026-09-14). Upstream is on 4.1, but stable `@yume-chan/scrcpy` (2.3.0) only ships option and layout support through 3.3.3 — 4.x exists only on its `3.0.0-beta` line. Pinning 3.3.3 keeps the scrcpy layer a stable dependency rather than something we hand-roll. Revisit when that beta goes stable.
- **Audio is in scope for v1** (2026-09-14). Reverses the earlier assumption. M2 opens the audio socket, and M3.5 decodes and plays it.

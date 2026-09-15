# Notes

Running log of latency and memory numbers, and of anything surprising found
along the way. Regressions in these numbers are the main thing that can quietly
kill this project (CLAUDE.md §8).

## Latency

| Date | Milestone | Glass-to-glass | Method | Notes |
|---|---|---|---|---|
| — | M3 | _not yet measured_ | stopwatch app, phone beside screen | Needs hardware; see below. |

M3's acceptance requires a glass-to-glass number measured against a stopwatch
app on the device. It cannot be measured in CI — record it here from a real
session, along with the device model and the negotiated resolution.

## Memory

| Date | Milestone | Session length | Result |
|---|---|---|---|
| — | M3 | 60 s | _not yet measured_ |

Watch for growth across a 60-second session. The usual cause of a leak here is
a `VideoFrame` that is not closed; see below for what is already verified.

## Environment findings

**The CI/dev container's Chromium has no H.264 at all.** `VideoDecoder`
and `VideoEncoder` both report `avc1.*` unsupported — Playwright's Chromium is
built without proprietary codecs. VP8, VP9 and AV1 are supported for both
encode and decode. Consequences:

- The H.264 decode path can only be exercised on real hardware.
- The pipeline itself was verified with VP8 instead, which is fine because
  everything except the codec string is codec-independent.
- The bundled ffmpeg (from the Playwright browser bundle) also has only PNG and
  VP8 encoders, so it cannot produce H.264 test vectors either.

**A closed `VideoFrame` does not throw on attribute access.** It reports
`codedWidth === 0`. Use `clone()`, which throws `InvalidStateError`, to assert
that a frame was actually closed. An earlier version of the harness reported
"frames not closed" purely because the probe was wrong.

## Why M3 showed no picture on real hardware

Two bugs, both found by driving the real `launchServer` and the real video
worker from a fake `Transport` in the browser — no device involved.

**An unread socket stalls every socket.** `audio: true` is passed to the
server, so it streams audio continuously, and the control socket carries device
messages. Neither was being read. ADB multiplexes all sockets over one
connection, so once an unread socket's buffer fills it blocks the entire
connection — video included. The symptom is a session that connects, reports a
codec, and then goes silent. Both streams are now drained until their real
consumers exist (M3.5 for audio, M4 for control). The same hazard already
applied to the spawned process's output, which `launchServer` has always
drained; the audio socket was simply missed.

**One rejected chunk killed the session.** A `VideoDecoder` that has just been
configured rejects anything before the first keyframe with "A key frame is
required after configure() or flush()". That error propagated out of the
`WritableStream.write` the packets were piped into, which rejected the pipe and
ended the stream permanently. The decoder now drops delta frames until a
keyframe arrives, and treats a failed `decode()` as recoverable — report it and
wait to resync — rather than fatal. Covered by unit tests with a stubbed
`VideoDecoder`.

Worth remembering: the fake-transport harness reproduced both without hardware.
The scrcpy video framing needed to fake it is a 64-byte device name, `u32`
codec id, `u32` width, `u32` height, then per packet a big-endian `u64` PTS,
`u32` length and payload — with bit 63 of the PTS marking a configuration
packet and bit 62 marking a keyframe.

## Verified without hardware (M3)

Driving the real `CanvasRenderer` with VP8 in headless Chromium, through the
same worker path the app uses:

- Transferring a `ReadableStream` of packets into a worker works, and Tango's
  `ReadableStream` is `globalThis.ReadableStream`, so it is genuinely
  transferable rather than a polyfill.
- `transferControlToOffscreen()` plus decode-and-draw inside the worker puts
  pixels on screen: 12/12 frames decoded and drawn.
- Every frame was closed after drawing (12/12), which is the failure mode
  CLAUDE.md §7 calls the most likely cause of "video freezes after a moment".
- The size callback fired once for a stable stream, so it is not firing per
  frame. Rotation behaviour still needs a real device.

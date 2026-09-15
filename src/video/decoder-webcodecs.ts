import type { ScrcpyMediaStreamPacket } from "@yume-chan/scrcpy";

import { parseH264Config, type VideoConfig } from "./demux";
import type { VideoSink } from "./renderer";

export interface DecoderCallbacks {
  onConfig?: (config: VideoConfig) => void;
  /** Reported but not fatal: the stream keeps running and waits to resync. */
  onDecodeError?: (error: Error) => void;
  onError: (error: Error) => void;
}

/**
 * Feeds scrcpy media packets into a WebCodecs `VideoDecoder` and hands decoded
 * frames to a sink.
 *
 * Chromium accepts Annex-B payloads directly as long as `description` is left
 * out of the decoder config, which is what scrcpy sends, so no conversion to
 * AVCC is needed.
 */
export class WebCodecsVideoDecoder {
  readonly #sink: VideoSink;
  readonly #callbacks: DecoderCallbacks;
  #decoder: VideoDecoder | undefined;
  #config: VideoConfig | undefined;
  #closed = false;
  // A freshly configured decoder rejects anything before the first keyframe
  // with "A key frame is required after configure()". Dropping deltas until
  // one arrives costs a few frames; feeding them throws instead.
  #needsKeyframe = true;
  #skipped = 0;

  constructor(sink: VideoSink, callbacks: DecoderCallbacks) {
    this.#sink = sink;
    this.#callbacks = callbacks;
  }

  get config(): VideoConfig | undefined {
    return this.#config;
  }

  #ensureDecoder(): VideoDecoder {
    this.#decoder ??= new VideoDecoder({
      output: (frame) => {
        if (this.#closed) {
          frame.close();
          return;
        }
        this.#sink.draw(frame);
      },
      error: (error: DOMException) => {
        this.#callbacks.onError(new Error(error.message));
      },
    });
    return this.#decoder;
  }

  handle(packet: ScrcpyMediaStreamPacket): void {
    if (this.#closed) {
      return;
    }

    if (packet.type === "configuration") {
      const config = parseH264Config(packet.data);
      // A rotation sends a fresh SPS. Reconfiguring on any change keeps the
      // decoder and the displayed size in step on the same packet.
      if (
        this.#config?.codec !== config.codec ||
        this.#config.codedWidth !== config.codedWidth ||
        this.#config.codedHeight !== config.codedHeight
      ) {
        this.#config = config;
        this.#ensureDecoder().configure({
          codec: config.codec,
          codedWidth: config.codedWidth,
          codedHeight: config.codedHeight,
          optimizeForLatency: true,
        });
        this.#needsKeyframe = true;
        this.#callbacks.onConfig?.(config);
      }
      return;
    }

    const decoder = this.#decoder;
    if (!decoder || decoder.state !== "configured") {
      // Frames before the first configuration packet cannot be decoded.
      return;
    }

    const keyframe = packet.keyframe === true;
    if (this.#needsKeyframe && !keyframe) {
      this.#skipped += 1;
      return;
    }

    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: keyframe ? "key" : "delta",
          timestamp: Number(packet.pts ?? 0n),
          data: packet.data,
        }),
      );
      this.#needsKeyframe = false;
    } catch (error) {
      // A rejected chunk must not tear down the stream: wait for the next
      // keyframe and carry on, rather than killing the whole session.
      this.#needsKeyframe = true;
      this.#callbacks.onDecodeError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  /** Frames dropped while waiting for a keyframe to resync on. */
  get skipped(): number {
    return this.#skipped;
  }

  close(): void {
    this.#closed = true;
    if (this.#decoder && this.#decoder.state !== "closed") {
      this.#decoder.close();
    }
    this.#decoder = undefined;
    this.#sink.close();
  }
}

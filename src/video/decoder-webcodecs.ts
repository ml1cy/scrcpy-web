import type {
  ScrcpyMediaStreamDataPacket,
  ScrcpyMediaStreamPacket,
} from "@yume-chan/scrcpy";

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
 * scrcpy sends Annex-B, which Chromium decodes only when `description` is left
 * out of the decoder config. In that mode the parameter sets have to travel in
 * the bitstream, so the SPS/PPS from a configuration packet is prepended to the
 * next keyframe rather than being used only to derive the codec string.
 */
export class WebCodecsVideoDecoder {
  readonly #sink: VideoSink;
  readonly #callbacks: DecoderCallbacks;
  #decoder: VideoDecoder | undefined;
  #config: VideoConfig | undefined;
  /** The raw SPS/PPS bytes, which must be replayed ahead of a keyframe. */
  #configData: Uint8Array | undefined;
  #configured = false;
  #closed = false;
  #skipped = 0;

  constructor(sink: VideoSink, callbacks: DecoderCallbacks) {
    this.#sink = sink;
    this.#callbacks = callbacks;
  }

  get config(): VideoConfig | undefined {
    return this.#config;
  }

  /** Frames dropped while waiting for a keyframe to resync on. */
  get skipped(): number {
    return this.#skipped;
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

  #configureAndDecodeKeyframe(
    decoder: VideoDecoder,
    config: VideoConfig,
    configData: Uint8Array,
    packet: ScrcpyMediaStreamDataPacket,
  ): void {
    // Coded dimensions are deliberately omitted: the SPS is authoritative, and
    // a mismatch here is rejected rather than corrected.
    decoder.configure({ codec: config.codec, optimizeForLatency: true });
    this.#configured = true;

    const data = new Uint8Array(configData.length + packet.data.length);
    data.set(configData, 0);
    data.set(packet.data, configData.length);

    decoder.decode(
      new EncodedVideoChunk({
        type: "key",
        timestamp: Number(packet.pts ?? 0n),
        data,
      }),
    );
  }

  handle(packet: ScrcpyMediaStreamPacket): void {
    if (this.#closed) {
      return;
    }

    if (packet.type === "configuration") {
      const config = parseH264Config(packet.data);
      this.#config = config;
      this.#configData = packet.data;
      // A rotation sends a fresh SPS; the decoder is reconfigured on the
      // keyframe that follows it, together with these bytes.
      this.#configured = false;
      this.#callbacks.onConfig?.(config);
      return;
    }

    const config = this.#config;
    const configData = this.#configData;
    if (!config || !configData) {
      // Nothing can be decoded before the first configuration packet.
      this.#skipped += 1;
      return;
    }

    // scrcpy before 1.23 sends no keyframe flag; an unflagged frame is treated
    // as a keyframe, which is what the decoder needs to start anyway.
    const keyframe = packet.keyframe !== false;
    const decoder = this.#ensureDecoder();

    try {
      if (keyframe) {
        // A backlog means the device is producing faster than this machine
        // decodes. Dropping it at a keyframe caps latency at one keyframe
        // interval instead of letting it grow for the whole session.
        if (this.#configured && decoder.decodeQueueSize > 0) {
          decoder.reset();
          this.#configured = false;
        }
        if (!this.#configured) {
          this.#configureAndDecodeKeyframe(decoder, config, configData, packet);
          return;
        }
      } else if (!this.#configured) {
        this.#skipped += 1;
        return;
      }

      decoder.decode(
        new EncodedVideoChunk({
          type: keyframe ? "key" : "delta",
          timestamp: Number(packet.pts ?? 0n),
          data: packet.data,
        }),
      );
    } catch (error) {
      // A rejected chunk must not tear down the stream: wait for the next
      // keyframe and carry on, rather than killing the whole session.
      this.#configured = false;
      this.#callbacks.onDecodeError?.(
        error instanceof Error ? error : new Error(String(error)),
      );
    }
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

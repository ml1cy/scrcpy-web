export interface VideoSink {
  draw(frame: VideoFrame): void;
  close(): void;
}

export type SizeListener = (width: number, height: number) => void;

/**
 * Draws decoded frames straight onto a canvas. Rendering is driven by decoder
 * output rather than a rAF loop, because background tabs and
 * `prefers-reduced-motion` throttle rAF and would stall the pipeline.
 */
export class CanvasRenderer implements VideoSink {
  readonly #canvas: OffscreenCanvas;
  readonly #context: OffscreenCanvasRenderingContext2D;
  readonly #onSize: SizeListener | undefined;
  #width = 0;
  #height = 0;

  constructor(canvas: OffscreenCanvas, onSize?: SizeListener) {
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Could not get a 2D context for the video canvas");
    }
    this.#canvas = canvas;
    this.#context = context;
    this.#onSize = onSize;
  }

  get width(): number {
    return this.#width;
  }

  get height(): number {
    return this.#height;
  }

  draw(frame: VideoFrame): void {
    try {
      // The frame is the authority on size, so a rotation mid-session resizes
      // the canvas without needing to re-read the stream metadata.
      const { displayWidth, displayHeight } = frame;
      if (displayWidth !== this.#width || displayHeight !== this.#height) {
        this.#width = displayWidth;
        this.#height = displayHeight;
        this.#canvas.width = displayWidth;
        this.#canvas.height = displayHeight;
        this.#onSize?.(displayWidth, displayHeight);
      }
      this.#context.drawImage(frame, 0, 0);
    } finally {
      // Not closing every frame stalls the decoder within seconds. The finally
      // matters: a draw that throws must still release the frame.
      frame.close();
    }
  }

  close(): void {
    this.#context.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
  }
}

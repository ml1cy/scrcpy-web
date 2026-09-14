import type {
  MaybeConsumable,
  ReadableStream,
  WritableStream,
} from "@yume-chan/stream-extra";

export interface DeviceInfo {
  serial: string;
  model: string;
  androidVersion: string;
}

/** A bidirectional ADB socket to a named service on the device. */
export interface DeviceSocket {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<MaybeConsumable<Uint8Array>>;
  close(): Promise<void>;
}

export interface DeviceProcess {
  /** stdout and stderr interleaved. Must be drained, or the ADB connection stalls. */
  readonly output: ReadableStream<Uint8Array>;
  readonly exited: Promise<void>;
  kill(): Promise<void>;
}

/**
 * An ADB connection to a single device. WebUSB implements this today; the M6
 * WebSocket bridge implements the same shape so the rest of the app is unaware
 * of which one it is talking to.
 *
 * Stream types come from `@yume-chan/stream-extra` rather than the DOM lib:
 * they are declared without a DOM dependency, so a Node bridge can satisfy
 * this same interface.
 */
export interface Transport {
  readonly serial: string;
  /** Resolves when the device goes away — cable pull, or the daemon dying. */
  readonly disconnected: Promise<void>;
  getDeviceInfo(): Promise<DeviceInfo>;
  pushFile(
    path: string,
    content: ReadableStream<MaybeConsumable<Uint8Array>>,
  ): Promise<void>;
  openSocket(service: string): Promise<DeviceSocket>;
  spawn(command: readonly string[]): Promise<DeviceProcess>;
  close(): Promise<void>;
}

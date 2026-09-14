export interface DeviceInfo {
  serial: string;
  model: string;
  androidVersion: string;
}

/**
 * An ADB connection to a single device. WebUSB implements this today; the M6
 * WebSocket bridge implements the same shape so the rest of the app is unaware
 * of which one it is talking to.
 */
export interface Transport {
  readonly serial: string;
  /** Resolves when the device goes away — cable pull, or the daemon dying. */
  readonly disconnected: Promise<void>;
  getDeviceInfo(): Promise<DeviceInfo>;
  close(): Promise<void>;
}

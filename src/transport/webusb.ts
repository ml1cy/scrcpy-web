import { Adb, AdbDaemonTransport } from "@yume-chan/adb";
import AdbWebCredentialStore from "@yume-chan/adb-credential-web";
import {
  AdbDaemonWebUsbDeviceManager,
  type AdbDaemonWebUsbDevice,
} from "@yume-chan/adb-daemon-webusb";

import type { DeviceInfo, Transport } from "./types";

// Names the IndexedDB store holding our ADB RSA key. Changing it invalidates
// every device authorization the user has already granted.
const CREDENTIAL_STORE_NAME = "scrcpy-web";

export class WebUsbUnavailableError extends Error {
  constructor() {
    super(
      "WebUSB is unavailable. Use a Chromium-based browser over HTTPS or localhost.",
    );
    this.name = "WebUsbUnavailableError";
  }
}

function deviceManager(): AdbDaemonWebUsbDeviceManager {
  const manager = AdbDaemonWebUsbDeviceManager.BROWSER;
  if (!manager) {
    throw new WebUsbUnavailableError();
  }
  return manager;
}

class WebUsbTransport implements Transport {
  readonly #adb: Adb;

  constructor(adb: Adb) {
    this.#adb = adb;
  }

  get serial(): string {
    return this.#adb.serial;
  }

  get disconnected(): Promise<void> {
    return this.#adb.disconnected;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const [model, androidVersion] = await Promise.all([
      this.#adb.getProp("ro.product.model"),
      this.#adb.getProp("ro.build.version.release"),
    ]);
    return { serial: this.serial, model, androidVersion };
  }

  async close(): Promise<void> {
    await this.#adb.close();
  }
}

async function connect(device: AdbDaemonWebUsbDevice): Promise<Transport> {
  const connection = await device.connect();
  const transport = await AdbDaemonTransport.authenticate({
    serial: device.serial,
    connection,
    credentialStore: new AdbWebCredentialStore(CREDENTIAL_STORE_NAME),
  });
  return new WebUsbTransport(new Adb(transport));
}

/**
 * Prompts the user to pick a device, then connects to it. Must be called from a
 * user gesture. Resolves to undefined if the user dismisses the picker.
 *
 * Tango filters the picker to the ADB interface (class 0xFF, subclass 0x42,
 * protocol 0x01) by default, so no explicit filter is passed here.
 */
export async function requestDevice(): Promise<Transport | undefined> {
  const device = await deviceManager().requestDevice();
  return device ? await connect(device) : undefined;
}

/**
 * Connects to a device the user has already granted permission to, without
 * showing the picker. This is what makes a page reload reconnect silently.
 */
export async function reconnectAuthorizedDevice(): Promise<
  Transport | undefined
> {
  const [device] = await deviceManager().getDevices();
  return device ? await connect(device) : undefined;
}

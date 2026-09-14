import type { MaybeConsumable } from "@yume-chan/stream-extra";
import { ReadableStream } from "@yume-chan/stream-extra";

import { SCRCPY_SERVER_DEVICE_PATH, SCRCPY_SERVER_URL } from "../constants";
import type { Transport } from "../transport/types";

/**
 * Pushes the vendored jar from the app origin onto the device. The jar is a
 * build artifact served next to the app, so this never reaches past the origin
 * the page was loaded from.
 */
export async function pushServer(transport: Transport): Promise<void> {
  const response = await fetch(SCRCPY_SERVER_URL);
  if (!response.ok) {
    throw new Error(
      `Could not fetch ${SCRCPY_SERVER_URL}: ${String(response.status)} ${response.statusText}`,
    );
  }

  // The jar is well under a megabyte, so buffering it is cheaper than bridging
  // fetch's native stream into Tango's own stream implementation.
  const bytes = new Uint8Array(await response.arrayBuffer());

  await transport.pushFile(
    SCRCPY_SERVER_DEVICE_PATH,
    new ReadableStream<MaybeConsumable<Uint8Array>>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
  );
}

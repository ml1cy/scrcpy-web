// Must match the jar in public/scrcpy-server.jar exactly, or the server exits
// immediately on launch. Never hardcode this version anywhere else.
export const SCRCPY_SERVER_VERSION = "3.3.3";

/** Where the jar is served from, relative to the app origin. */
export const SCRCPY_SERVER_URL = "/scrcpy-server.jar";

/** Where the jar is pushed to on the device. */
export const SCRCPY_SERVER_DEVICE_PATH = "/data/local/tmp/scrcpy-server.jar";

export const DEFAULT_MAX_SIZE = 1280;
export const DEFAULT_VIDEO_BIT_RATE = 8_000_000;

import { useCallback, useEffect, useRef, useState } from "react";

import type { DeviceInfo, Transport } from "../transport/types";
import {
  reconnectAuthorizedDevice,
  requestDevice,
} from "../transport/webusb";

type Status =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; info: DeviceInfo }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const transportRef = useRef<Transport | null>(null);

  const attach = useCallback(async (transport: Transport | undefined) => {
    if (!transport) {
      setStatus({ kind: "idle" });
      return;
    }
    transportRef.current = transport;
    void transport.disconnected.then(() => {
      transportRef.current = null;
      setStatus({ kind: "idle" });
    });
    setStatus({ kind: "connected", info: await transport.getDeviceInfo() });
  }, []);

  const open = useCallback(
    async (source: () => Promise<Transport | undefined>) => {
      setStatus({ kind: "connecting" });
      try {
        await attach(await source());
      } catch (error) {
        setStatus({ kind: "error", message: errorMessage(error) });
      }
    },
    [attach],
  );

  // A device the user already authorized reconnects on load, with no picker and
  // no second prompt on the phone. The ref guard keeps StrictMode's double-run
  // from claiming the USB interface twice.
  const reconnected = useRef(false);
  useEffect(() => {
    if (reconnected.current) {
      return;
    }
    reconnected.current = true;
    void open(reconnectAuthorizedDevice);
  }, [open]);

  const handleConnect = () => void open(requestDevice);

  const handleDisconnect = async () => {
    const transport = transportRef.current;
    transportRef.current = null;
    setStatus({ kind: "idle" });
    await transport?.close();
  };

  return (
    <main>
      <h1>scrcpy-web</h1>

      {status.kind === "connected" ? (
        <>
          <dl>
            <dt>Model</dt>
            <dd>{status.info.model}</dd>
            <dt>Android</dt>
            <dd>{status.info.androidVersion}</dd>
            <dt>Serial</dt>
            <dd>{status.info.serial}</dd>
          </dl>
          <button onClick={() => void handleDisconnect()}>Disconnect</button>
        </>
      ) : (
        <button
          onClick={handleConnect}
          disabled={status.kind === "connecting"}
        >
          {status.kind === "connecting" ? "Connecting…" : "Connect"}
        </button>
      )}

      {status.kind === "error" && <p role="alert">{status.message}</p>}
    </main>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";

import { SCRCPY_SERVER_VERSION } from "../constants";
import type { DeviceInfo, Transport } from "../transport/types";
import { reconnectAuthorizedDevice, requestDevice } from "../transport/webusb";
import type { SessionState } from "./useScrcpySession";
import { useScrcpySession } from "./useScrcpySession";
import "./styles.css";

type Status =
  | { kind: "idle" }
  | { kind: "connecting" }
  | { kind: "connected"; info: DeviceInfo }
  | { kind: "error"; message: string };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function DeviceGlyph({ size = 26 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M11 5.5h2" />
      <circle cx="12" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AlertGlyph() {
  return (
    <svg
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5v5.5" />
      <circle cx="12" cy="16.5" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} onClose={onClose}>
      <div className="about">
        <h2>About scrcpy-web</h2>
        <p>
          Mirrors and controls an Android device from the browser over WebUSB.
          The device talks straight to this tab — no native client, no server,
          and no data leaves your machine.
        </p>
        <p>
          Built on{" "}
          <a href="https://github.com/Genymobile/scrcpy">scrcpy</a> by
          Genymobile, licensed under Apache 2.0, whose server is redistributed
          here unmodified (v{SCRCPY_SERVER_VERSION}). ADB support comes from{" "}
          <a href="https://github.com/yume-chan/ya-webadb">Tango</a>, licensed
          under MIT.
        </p>
        <div className="about-actions">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => ref.current?.close()}
          >
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${String(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SessionBlock({
  state,
  onStart,
}: {
  state: SessionState;
  onStart: () => void;
}) {
  if (state.kind === "starting") {
    return (
      <p className="next-up next-up-busy">
        <span className="spinner spinner-sm" />
        {state.step}
      </p>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <p className="error-detail" role="alert">
          {state.message}
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onStart}
        >
          Try again
        </button>
      </>
    );
  }

  if (state.kind === "streaming") {
    const { video, stats, audioCodec } = state;
    return (
      <div className="stream">
        <div className="stream-head">
          <span className="dot" />
          {video ? "Mirroring" : "Waiting for first frame…"}
        </div>
        <dl className="props">
          <dt>Video</dt>
          <dd>
            {video
              ? `${video.codec} · ${String(video.width)}×${String(video.height)}`
              : "negotiating"}
          </dd>
          <dt>Audio</dt>
          <dd>{audioCodec ?? "not available"}</dd>
          <dt>Frames</dt>
          <dd>
            {String(stats.frames)} decoded · {String(stats.packets)} packets
          </dd>
          <dt>Received</dt>
          <dd>{formatBytes(stats.bytes)}</dd>
        </dl>
      </div>
    );
  }

  return (
    <>
      <p className="next-up">
        Connected over ADB. Start the server to push scrcpy to the device and
        begin mirroring the screen.
      </p>
      <button
        type="button"
        className="btn btn-primary"
        onClick={onStart}
      >
        Start mirroring
      </button>
    </>
  );
}

export function App() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [aboutOpen, setAboutOpen] = useState(false);
  const [transport, setTransport] = useState<Transport | null>(null);
  const {
    state: sessionState,
    start: startSession,
    stop: stopSession,
    canvasRef,
    canvasKey,
  } = useScrcpySession(transport);

  const attach = useCallback(async (next: Transport | undefined) => {
    if (!next) {
      setStatus({ kind: "idle" });
      return;
    }
    setTransport(next);
    void next.disconnected.then(() => {
      setTransport(null);
      setStatus({ kind: "idle" });
    });
    setStatus({ kind: "connected", info: await next.getDeviceInfo() });
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
    const current = transport;
    setTransport(null);
    setStatus({ kind: "idle" });
    await stopSession();
    await current?.close();
  };

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">
          <DeviceGlyph size={20} />
          scrcpy<span className="brand-dim">-web</span>
        </span>
        <span className="topbar-spacer" />
        <span
          className={status.kind === "connected" ? "pill pill-live" : "pill"}
          aria-live="polite"
        >
          <span className="dot" />
          {status.kind === "connected"
            ? "Connected"
            : status.kind === "connecting"
              ? "Connecting"
              : "No device"}
        </span>
      </header>

      <main className="stage">
        {status.kind === "connected" ? (
          <section className="panel panel-wide">
            <div className="device-head">
              <span className="glyph" style={{ margin: 0, width: 44, height: 44 }}>
                <DeviceGlyph size={22} />
              </span>
              <h1>{status.info.model}</h1>
            </div>

            <dl className="props">
              <dt>Android</dt>
              <dd>{status.info.androidVersion}</dd>
              <dt>Serial</dt>
              <dd>{status.info.serial}</dd>
              <dt>Server</dt>
              <dd>scrcpy {SCRCPY_SERVER_VERSION}</dd>
            </dl>

            {/* Kept mounted so transferControlToOffscreen has an element to
                claim the moment the session starts. */}
            <div className="screen" hidden={sessionState.kind !== "streaming"}>
              <canvas key={canvasKey} ref={canvasRef} />
            </div>

            <SessionBlock
              state={sessionState}
              onStart={() => void startSession()}
            />

            <div className="device-actions">
              {sessionState.kind === "streaming" && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void stopSession()}
                >
                  Stop mirroring
                </button>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-danger"
                onClick={() => void handleDisconnect()}
              >
                Disconnect
              </button>
            </div>
          </section>
        ) : (
          <section className="panel">
            <span className={status.kind === "error" ? "glyph glyph-error" : "glyph"}>
              {status.kind === "error" ? (
                <AlertGlyph />
              ) : status.kind === "connecting" ? (
                <span className="spinner" />
              ) : (
                <DeviceGlyph />
              )}
            </span>

            <h1>
              {status.kind === "error"
                ? "Could not connect"
                : status.kind === "connecting"
                  ? "Connecting…"
                  : "Mirror your Android device"}
            </h1>

            {status.kind === "error" ? (
              <p className="error-detail" role="alert">
                {status.message}
              </p>
            ) : (
              <p className="lede">
                Plug in over USB and control your phone from this tab. Nothing
                is installed, and the device talks straight to your browser.
              </p>
            )}

            <button
              type="button"
              className="btn btn-primary"
              onClick={handleConnect}
              disabled={status.kind === "connecting"}
            >
              {status.kind === "error" ? "Try again" : "Connect device"}
            </button>

            <ul className="hints">
              <li>Requires a Chromium-based browser — Chrome or Edge.</li>
              <li>Enable USB debugging in the phone&rsquo;s developer options.</li>
              <li>
                Run <code>adb kill-server</code> first — a local ADB server
                holds the USB interface.
              </li>
            </ul>
          </section>
        )}
      </main>

      <footer className="footer">
        <span>scrcpy {SCRCPY_SERVER_VERSION}</span>
        <span className="footer-spacer" />
        <button
          type="button"
          className="link-button"
          onClick={() => setAboutOpen(true)}
        >
          About &amp; licenses
        </button>
        <a href="https://github.com/ml1cy/scrcpy-web">Source</a>
      </footer>

      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
    </div>
  );
}

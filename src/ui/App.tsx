import { useState } from "react";

export function App() {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = () => {
    // WebUSB device selection + Tango handshake land in M1.
    setConnecting(true);
  };

  return (
    <main>
      <h1>scrcpy-web</h1>
      <button onClick={handleConnect} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect"}
      </button>
    </main>
  );
}

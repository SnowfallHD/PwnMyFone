import React from 'react';
import { createRoot } from 'react-dom/client';
import { invoke } from '@tauri-apps/api/core';
import './style.css';
function App() {
  const [status, setStatus] = React.useState('Device detection is not implemented yet.');
  const [busy, setBusy] = React.useState(false);
  async function check() {
    setBusy(true);
    try { setStatus(await invoke<string>('device_engine_status')); }
    catch { setStatus('The native engine could not be reached. Open the desktop app to check its status.'); }
    finally { setBusy(false); }
  }
  return <main><header><div className="brand">PwnMyFone<span>DEVICE TOOLKIT</span></div><span className="version">Development · 0.1.0</span></header><section><div className="phone" aria-hidden="true"><div/></div><h1>A fresh start for your phone.</h1><p>Your device toolkit starts here. Detection and restore tools are being built for macOS and Windows.</p><button onClick={check} disabled={busy}>{busy ? 'Checking…' : 'Check engine status'}</button><div className="status" role="status">{status}</div></section><footer><span>Native Rust engine · Tauri desktop</span><span>No device changes available in this build</span></footer></main>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);

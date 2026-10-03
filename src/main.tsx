import React from "react";
import { createRoot } from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import "./style.css";
type Device = {
  ecid: string;
  name: string;
  mode: string;
  product: string | null;
};
type Snapshot = { devices: Device[]; ready: boolean; issue: string | null };
type Job = {
  phase: string;
  running: boolean;
  ecid: string | null;
  message: string;
  lines: string[];
  progress: [string, number] | null;
};
const emptyJob: Job = {
  phase: "",
  running: false,
  ecid: null,
  message: "",
  lines: [],
  progress: null,
};
function App() {
  const [snapshot, setSnapshot] = React.useState<Snapshot>({
    devices: [],
    ready: false,
    issue: null,
  });
  const [job, setJob] = React.useState<Job>(emptyJob);
  const [selected, setSelected] = React.useState("");
  const [error, setError] = React.useState("");
  const [checking, setChecking] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [phrase, setPhrase] = React.useState("");
  const [home, setHome] = React.useState(true);
  const device = snapshot.devices.find((d) => d.ecid === selected);
  const ready = job.phase === "ready" && job.ecid === selected;
  React.useEffect(() => {
    let stopped = false;
    async function poll() {
      try {
        const current = await invoke<Job>("job_status");
        if (stopped) return;
        setJob(current);
        if (!current.running) {
          const result = await invoke<Snapshot>("device_snapshot");
          if (stopped) return;
          setSnapshot(result);
          setSelected((prev) =>
            result.devices.some((d) => d.ecid === prev)
              ? prev
              : result.devices.length === 1
                ? result.devices[0].ecid
                : "",
          );
        }
      } catch (e) {
        if (!stopped) setError(String(e));
      } finally {
        if (!stopped) {
          setChecking(false);
          timer = window.setTimeout(poll, 2000);
        }
      }
    }
    let timer = window.setTimeout(poll, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  React.useEffect(() => {
    setConfirm(false);
    setPhrase("");
  }, [selected]);
  async function action(
    kind: "prepare_firmware" | "erase_restore" | "enter_recovery",
  ) {
    if (!device || busy || job.running) return;
    setBusy(true);
    setError("");
    try {
      await invoke(kind, {
        ecid: device.ecid,
        ...(kind === "erase_restore" ? { confirmation: phrase } : {}),
      });
      setConfirm(false);
      setPhrase("");
      setJob(await invoke<Job>("job_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  const active = job.running || busy;
  return (
    <main>
      <header>
        <div className="brand">
          PwnMyFone<span>DEVICE TOOLKIT</span>
        </div>
        <span className="version">Development · macOS</span>
      </header>
      <div className="workspace">
        <section className="device-area">
          <div
            className={`device-art ${device ? "connected" : "searching"} ${active ? "working" : ""}`}
            aria-hidden="true"
          >
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="phone">
              <div className="camera" />
              <div className="screen-symbol">{device ? "✓" : ""}</div>
              <div className="home-dot" />
            </div>
            <div className="cable">
              <div className="connector" />
            </div>
          </div>
          <h1>
            {job.phase === "complete"
              ? "Hello, fresh start."
              : device
                ? "Your device is connected."
                : "Plug in your device."}
          </h1>
          <p>
            {device
              ? "We’ll prepare compatible firmware, then erase and restore your device to remove its screen passcode."
              : "Connect your iPad or iPhone with a USB data cable. We’ll detect it automatically."}
          </p>
          <div className="connection" role="status">
            <span className={`dot ${device ? "online" : ""}`} />
            {active
              ? "Device operation in progress"
              : checking
                ? "Checking USB connection…"
                : device
                  ? `${device.name} · ${device.mode} mode`
                  : "Waiting for a device · checking automatically"}
          </div>
          {snapshot.devices.length > 1 && (
            <label className="select-label">
              Choose your device
              <select
                disabled={active}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Select a device</option>
                {snapshot.devices.map((d) => (
                  <option value={d.ecid} key={d.ecid}>
                    {d.name} · ECID {d.ecid}
                  </option>
                ))}
              </select>
            </label>
          )}
          {device && (
            <div className="identity">
              <span>{device.product ?? "Model not yet identified"}</span>
              <span>ECID {device.ecid}</span>
            </div>
          )}
        </section>
        <aside className="workflow">
          <h2>Remove screen passcode</h2>
          <p className="intro">
            A full erase and firmware restore. Your photos, apps, and settings
            will be removed.
          </p>
          <div className="step">
            <span className={`step-number ${ready ? "done" : ""}`}>1</span>
            <div>
              <h3>Prepare firmware</h3>
              <p>
                Download and check currently signed firmware. Requires internet
                and 25 GB of free space on this Mac.
              </p>
              <button
                disabled={!device || !snapshot.ready || active || ready}
                onClick={() => action("prepare_firmware")}
              >
                {job.phase === "preparing"
                  ? "Preparing firmware…"
                  : ready
                    ? "Firmware ready"
                    : "Download firmware"}
              </button>
            </div>
          </div>
          <div className="step">
            <span
              className={`step-number ${device?.mode === "Recovery" ? "done" : ""}`}
            >
              2
            </span>
            <div>
              <h3>Enter recovery mode automatically</h3>
              <p>
                After firmware preparation, we ask the selected device to
                restart into recovery. This does not erase data.
              </p>
              <button
                disabled={!device || active || device.mode !== "Normal"}
                onClick={() => action("enter_recovery")}
              >
                Enter recovery now
              </button>
              <details>
                <summary>
                  Button instructions if automatic recovery fails
                </summary>
                <div
                  className="toggle"
                  role="group"
                  aria-label="Device button layout"
                >
                  <button
                    className={home ? "chosen" : ""}
                    disabled={active}
                    onClick={() => setHome(true)}
                  >
                    Home button
                  </button>
                  <button
                    className={!home ? "chosen" : ""}
                    disabled={active}
                    onClick={() => setHome(false)}
                  >
                    No Home button
                  </button>
                </div>
                <p>
                  {home
                    ? "Turn off your iPad, then reconnect it. Hold Home and the top button together. Keep holding past the Apple logo until the cable/computer screen appears."
                    : "Turn off and reconnect your iPad. Without Home: press and release the volume button nearest the top button, then the other volume button. Hold the top button past the Apple logo until the recovery screen appears."}
                </p>
                <small>
                  If recovery mode expires during download, enter it again
                  afterward. Keep the device charged. These button instructions
                  are for iPad.
                </small>
              </details>
              <div className="mode-state">
                {device?.mode === "Recovery"
                  ? "Recovery mode detected ✓"
                  : "Waiting for recovery mode"}
              </div>
            </div>
          </div>
          <div className="step">
            <span className="step-number">3</span>
            <div>
              <h3>Erase and restore</h3>
              <p>
                Activation Lock stays in place. You may need the linked Apple
                Account during setup.
              </p>
              <button
                className="danger"
                disabled={
                  !device || !ready || device.mode !== "Recovery" || active
                }
                onClick={() => setConfirm(true)}
              >
                Review erase confirmation
              </button>
            </div>
          </div>
        </aside>
      </div>
      {(error || snapshot.issue) && (
        <div className="error" role="alert">
          {error || snapshot.issue}
        </div>
      )}
      {job.phase && (
        <section className="operation" aria-live="polite">
          <div className="operation-heading">
            <h2>
              {(
                {
                  preparing: "Preparing firmware",
                  ready: "Ready for recovery",
                  recovering: "Entering recovery mode",
                  recovery: "Recovery request finished",
                  restoring: "Restoring device",
                  complete: "Restore engine completed",
                  failed: "Operation needs attention",
                } as Record<string, string>
              )[job.phase] ?? job.phase}
            </h2>
            {job.running && <span className="spinner" />}
          </div>
          <p>{job.message}</p>
          {job.progress && job.running && (
            <div className="progress">
              <span>
                {job.progress[0]} · {job.progress[1].toFixed(0)}%
              </span>
              <progress max="100" value={job.progress[1]} />
            </div>
          )}
          {job.lines.length > 0 && (
            <details open={job.running || job.phase === "failed"}>
              <summary>Live engine output · stays on this Mac</summary>
              <pre>{job.lines.join("\n")}</pre>
            </details>
          )}
        </section>
      )}
      {confirm && device && (
        <div className="modal-backdrop">
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="erase-title"
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setConfirm(false);
                setPhrase("");
              }
              if (event.key === "Tab") {
                const controls = Array.from(
                  event.currentTarget.querySelectorAll<HTMLElement>(
                    "input, button:not(:disabled)",
                  ),
                );
                const first = controls[0],
                  last = controls[controls.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                  event.preventDefault();
                  last?.focus();
                }
                if (!event.shiftKey && document.activeElement === last) {
                  event.preventDefault();
                  first?.focus();
                }
              }
            }}
          >
            <h2 id="erase-title">Erase this {device.name}?</h2>
            <p>
              All data on this device will be permanently removed. The screen
              passcode will be removed through a firmware restore. Activation
              Lock is not removed.
            </p>
            <div className="target">
              {device.product} · ECID {device.ecid}
            </div>
            <label>
              Type <strong>ERASE</strong> to confirm
              <input
                autoFocus
                autoComplete="off"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                placeholder="ERASE"
              />
            </label>
            <div className="modal-actions">
              <button
                className="secondary"
                onClick={() => {
                  setConfirm(false);
                  setPhrase("");
                }}
              >
                Keep my device
              </button>
              <button
                className="danger"
                disabled={
                  phrase !== "ERASE" || active || device.mode !== "Recovery"
                }
                onClick={() => action("erase_restore")}
              >
                Erase and restore
              </button>
            </div>
          </div>
        </div>
      )}
      <footer>
        <span>Tauri + Rust · local device operations</span>
        <span>
          {active
            ? "Keep this app open and your device connected"
            : "Apple Account ownership locks remain intact"}
        </span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

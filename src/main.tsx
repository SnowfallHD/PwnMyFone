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
type Action = "prepare_firmware" | "erase_restore" | "enter_recovery";
const emptyJob: Job = {
  phase: "",
  running: false,
  ecid: null,
  message: "",
  lines: [],
  progress: null,
};

function EraseDialog({
  device,
  disabled,
  error,
  onDismiss,
  onErase,
}: {
  device: Device;
  disabled: boolean;
  error: string;
  onDismiss: () => void;
  onErase: (phrase: string) => void;
}) {
  const [phrase, setPhrase] = React.useState("");
  const dialog = React.useRef<HTMLDialogElement>(null);
  React.useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="erase-dialog"
      aria-labelledby="erase-title"
      onCancel={(e) => {
        e.preventDefault();
        onDismiss();
      }}
    >
      <div className="warning-icon" aria-hidden="true">
        !
      </div>
      <div className="eyebrow">FINAL CONFIRMATION</div>
      <h2 id="erase-title">
        Erase this {device.product?.startsWith("iPad") ? "iPad" : "iPhone"}?
      </h2>
      <p>
        All photos, apps, and settings will be permanently deleted. Restoring
        removes the screen passcode.
      </p>
      <div className="confirm-device">
        <strong>{device.name}</strong>
        <span>
          {device.product} · ECID {device.ecid}
        </span>
      </div>
      <p className="ownership">
        Activation Lock stays in place. Setup may require the Apple Account
        previously linked to this device.
      </p>
      <label className="phrase-label">
        Type <strong>ERASE</strong> to confirm
        <input
          autoComplete="off"
          spellCheck={false}
          value={phrase}
          onChange={(e) => setPhrase(e.target.value)}
          placeholder="ERASE"
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button className="secondary" disabled={disabled} onClick={onDismiss}>
          Keep my device
        </button>
        <button
          className="danger"
          disabled={phrase !== "ERASE" || disabled}
          onClick={() => onErase(phrase)}
        >
          Erase and restore
        </button>
      </div>
    </dialog>
  );
}

function RecoveryHelp({
  isPhone,
  disabled,
}: {
  isPhone: boolean;
  disabled: boolean;
}) {
  const [layout, setLayout] = React.useState("home");
  const instructions = isPhone
    ? layout === "home"
      ? "Turn off the iPhone. Reconnect the cable and immediately hold Home until the cable/computer screen appears."
      : layout === "seven"
        ? "Turn off the iPhone. Reconnect the cable and immediately hold Volume Down until the cable/computer screen appears."
        : "Turn off the iPhone. Reconnect the cable and immediately hold the side button past the Apple logo until the cable/computer screen appears."
    : layout === "home"
      ? "Hold Home and the top button together. When the iPad turns off, release the top button and keep holding Home until the cable/computer screen appears."
      : "Press and release the volume button nearest the top button, then the other volume button. Hold the top button past the Apple logo until the recovery screen appears.";
  return (
    <details className="recovery-help">
      <summary>Use buttons instead</summary>
      <div className="help-content">
        <label>
          Device button layout
          <select
            disabled={disabled}
            value={layout}
            onChange={(e) => setLayout(e.target.value)}
          >
            <option value="home">
              {isPhone ? "iPhone 6s or earlier" : "iPad with Home button"}
            </option>
            {isPhone && <option value="seven">iPhone 7 / 7 Plus</option>}
            <option value="modern">
              {isPhone ? "iPhone 8 or later" : "iPad without Home button"}
            </option>
          </select>
        </label>
        <p>Keep the device connected to this Mac. {instructions}</p>
      </div>
    </details>
  );
}

function App() {
  const [snapshot, setSnapshot] = React.useState<Snapshot>({
    devices: [],
    ready: false,
    issue: null,
  });
  const [job, setJob] = React.useState(emptyJob);
  const [selected, setSelected] = React.useState("");
  const [error, setError] = React.useState("");
  const [scanError, setScanError] = React.useState("");
  const [checking, setChecking] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  const [helloVerified, setHelloVerified] = React.useState(false);
  const reviewButton = React.useRef<HTMLButtonElement>(null);
  const pending = React.useRef(false);
  const revision = React.useRef(0);
  const device = snapshot.devices.find((d) => d.ecid === selected);
  const ready = job.phase === "ready" && job.ecid === selected;
  const active = job.running || busy;
  const completed =
    job.phase === "complete" && (!device || job.ecid === device.ecid);
  const recovery = device?.mode === "Recovery";
  const identified = !!device?.product?.match(/^(iPad|iPhone)/);
  const canOperate =
    !!device &&
    identified &&
    snapshot.ready &&
    !scanError &&
    !active &&
    (device.mode === "Normal" || recovery);
  const canErase = canOperate && ready && recovery;
  const isPhone = device?.product?.startsWith("iPhone") ?? false;
  const noun = isPhone ? "iPhone" : "iPad";
  const needsRecovery =
    !!device &&
    !active &&
    ((ready && !recovery) || !identified || device.mode === "DFU");

  React.useEffect(() => {
    let stopped = false;
    let timer: number;
    async function poll() {
      const version = revision.current;
      try {
        const current = await invoke<Job>("job_status");
        if (stopped || version !== revision.current) return;
        setJob(current);
        if (!current.running) {
          const result = await invoke<Snapshot>("device_snapshot");
          if (stopped || version !== revision.current) return;
          setSnapshot(result);
          setScanError("");
          setSelected((prev) =>
            result.devices.some((d) => d.ecid === prev)
              ? prev
              : result.devices.length === 1
                ? result.devices[0].ecid
                : "",
          );
        }
      } catch (e) {
        if (!stopped && version === revision.current) setScanError(String(e));
      } finally {
        if (!stopped) {
          setChecking(false);
          timer = window.setTimeout(poll, 2000);
        }
      }
    }
    timer = window.setTimeout(poll, 0);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  React.useEffect(() => {
    if (!canErase) setConfirm(false);
  }, [canErase]);
  React.useEffect(() => {
    setError("");
    setConfirm(false);
  }, [selected]);
  React.useEffect(() => {
    setHelloVerified(false);
  }, [job.phase, job.ecid, selected]);

  function dismissReview() {
    setConfirm(false);
    window.requestAnimationFrame(() => reviewButton.current?.focus());
  }

  async function action(kind: Action, phrase?: string) {
    if (
      !device ||
      pending.current ||
      job.running ||
      (kind === "erase_restore" && !canErase)
    )
      return;
    pending.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    try {
      await invoke(kind, {
        ecid: device.ecid,
        ...(kind === "erase_restore" ? { confirmation: phrase } : {}),
      });
      setConfirm(false);
      setJob(await invoke<Job>("job_status"));
    } catch (e) {
      setError(String(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const stage = completed
    ? 3
    : job.phase === "restoring"
      ? 2
      : ready
        ? recovery
          ? 2
          : 1
        : job.phase === "recovering"
          ? 1
          : 0;
  const title = active
    ? job.phase === "restoring"
      ? `Restoring your ${noun}.`
      : job.phase === "recovering"
        ? "Entering recovery mode."
        : "Preparing your fresh start."
    : completed
      ? helloVerified
        ? "Your fresh start is ready."
        : "Check your device."
      : !device
        ? snapshot.devices.length > 1
          ? "Choose your device."
          : "Let’s get you connected."
        : needsRecovery
          ? "One more step: recovery."
          : ready
            ? "Ready when you are."
            : `A fresh start for your ${noun}.`;
  const description = active
    ? job.phase === "restoring"
      ? "Keep the cable connected and this app open while your device is erased and restored."
      : job.phase === "recovering"
        ? "Your device will restart. We’ll check that the same device returns in recovery mode."
        : "We’re downloading and checking compatible firmware. Your data stays on the device during this step."
    : completed
      ? helloVerified
        ? "You confirmed the Hello screen. Follow setup on the device; the linked Apple Account may still be required."
        : "The restore engine reported completion. Confirm that the device shows the Hello setup screen."
      : !device
        ? "Connect an iPad or iPhone with a USB data cable. We’ll take it from there."
        : needsRecovery
          ? "We need your device in recovery mode before continuing. This restart does not erase data."
          : ready
            ? "Firmware is checked and recovery mode is confirmed. Review exactly what will be erased before continuing."
            : "We’ll prepare compatible firmware and enter recovery automatically. You choose when to erase.";
  const firmware = job.lines
    .find((l) => l.startsWith("Selected firmware "))
    ?.replace("Selected firmware ", "");
  const shownError =
    error ||
    scanError ||
    snapshot.issue ||
    (job.phase === "failed" ? job.message : "");

  return (
    <>
      <main>
        <header>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <i />
            </span>
            PwnMyFone
          </div>
          <span className="build-label">LOCAL RECOVERY · PREVIEW</span>
        </header>
        <section className="recovery-surface" aria-labelledby="stage-title">
          <div className="ambient ambient-one" aria-hidden="true" />
          <div className="ambient ambient-two" aria-hidden="true" />
          <div className="journey" aria-label="Recovery stages">
            {["Prepare", "Recovery", "Restore"].map((label, i) => (
              <div
                key={label}
                className={`journey-step ${stage > i ? "done" : stage === i ? "current" : ""}`}
                aria-current={stage === i ? "step" : undefined}
              >
                <span>{stage > i ? "✓" : i + 1}</span>
                {label}
              </div>
            ))}
          </div>
          <div className="stage-layout">
            <div
              className={`device-scene ${isPhone ? "is-phone" : "is-tablet"} ${device || active || completed ? "connected" : "searching"} ${active ? "working" : ""} ${completed ? "finished" : ""}`}
              aria-hidden="true"
            >
              <div className="device-halo" />
              <div className="device-body">
                <div className="camera" />
                <div className="device-screen">
                  {completed ? (
                    <span className="hello">hello</span>
                  ) : active ? (
                    <span className="device-loader" />
                  ) : device ? (
                    <span className="screen-check">✓</span>
                  ) : (
                    <span className="screen-usb">↧</span>
                  )}
                </div>
                <div className="home-dot" />
              </div>
              {!completed && (
                <div className="cable">
                  <div className="connector" />
                  <div className="cable-line" />
                </div>
              )}
              <span className="scene-caption">
                {completed
                  ? "CHECK THE SETUP SCREEN"
                  : active
                    ? "KEEP CONNECTED"
                    : device
                      ? "CONNECTED TO THIS MAC"
                      : "USB CONNECTION"}
              </span>
            </div>
            <div className="stage-content">
              <div className="eyebrow">
                {active
                  ? "WORKING ON IT"
                  : completed
                    ? "YOUR DEVICE, YOUR NEXT STEP"
                    : ready
                      ? "FINAL STEP"
                      : "SCREEN PASSCODE RECOVERY"}
              </div>
              <h1 id="stage-title">{title}</h1>
              <p className="stage-description">{description}</p>
              {snapshot.devices.length > 1 && !active && !completed && (
                <label className="device-choice">
                  Connected devices
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                  >
                    <option value="">Choose a device</option>
                    {snapshot.devices.map((d) => (
                      <option key={d.ecid} value={d.ecid}>
                        {d.name} · {d.ecid}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {device && !completed && (
                <div className="device-summary">
                  <div>
                    <strong>
                      {device.name === "iPad" || device.name === "iPhone"
                        ? `${device.name} · ${device.product ?? "Identifying model"}`
                        : device.name}
                    </strong>
                    <span>
                      {active
                        ? "Operation in progress"
                        : (device.product ?? "Model not yet identified")}
                    </span>
                  </div>
                  <span className={`mode-badge ${recovery ? "verified" : ""}`}>
                    {active
                      ? "Connected"
                      : recovery
                        ? "Recovery ✓"
                        : device.mode}
                  </span>
                </div>
              )}
              {shownError && (
                <div className="error-card" role="alert">
                  <strong>Let’s resolve this first.</strong>
                  <p>{shownError}</p>
                </div>
              )}
              <div className="action-area">
                {active ? (
                  <div className="progress-card">
                    <div className="progress-heading">
                      <span className="spinner" />
                      <strong>
                        {job.progress
                          ? `${job.progress[0]} firmware`
                          : job.phase === "recovering"
                            ? "Waiting for recovery"
                            : job.phase === "restoring"
                              ? "Restore in progress"
                              : "Finding compatible firmware"}
                      </strong>
                      {job.progress && (
                        <span className="progress-number">
                          {job.progress[1].toFixed(0)}%
                        </span>
                      )}
                    </div>
                    <progress
                      aria-label={job.progress?.[0] ?? "Device operation"}
                      max="100"
                      {...(job.progress ? { value: job.progress[1] } : {})}
                    />
                    <p>
                      {job.phase === "restoring"
                        ? "The device may restart several times."
                        : job.phase === "recovering"
                          ? "A brief USB disconnect is expected during restart."
                          : "Nothing is erased until you confirm the final step."}
                    </p>
                  </div>
                ) : completed ? (
                  helloVerified ? (
                    <div className="completion-note">
                      <span>✓</span> Hello screen confirmed by you
                    </div>
                  ) : (
                    <button
                      className="primary"
                      onClick={() => setHelloVerified(true)}
                    >
                      I see the Hello screen <span aria-hidden="true">✓</span>
                    </button>
                  )
                ) : !device ? (
                  <div className="waiting-status" role="status">
                    <span className="status-dot" />
                    {checking
                      ? "Checking USB…"
                      : snapshot.devices.length > 1
                        ? "Select the device you want to recover"
                        : "Waiting for your device"}
                  </div>
                ) : needsRecovery ? (
                  <>
                    <button
                      className="primary"
                      disabled={!canOperate || device.mode !== "Normal"}
                      onClick={() => action("enter_recovery")}
                    >
                      Enter recovery mode <span aria-hidden="true">↗</span>
                    </button>
                    <RecoveryHelp isPhone={isPhone} disabled={active} />
                    {ready && (
                      <p className="action-caption">
                        Your checked firmware is still ready.
                      </p>
                    )}
                  </>
                ) : ready ? (
                  <>
                    <button
                      className="primary"
                      disabled={!canErase}
                      ref={reviewButton}
                      onClick={() => setConfirm(true)}
                    >
                      Review erase confirmation{" "}
                      <span aria-hidden="true">→</span>
                    </button>
                    <p className="action-caption">
                      Nothing is erased by opening this review.
                    </p>
                  </>
                ) : (
                  <>
                    <button
                      className="primary"
                      disabled={!canOperate}
                      onClick={() => action("prepare_firmware")}
                    >
                      {job.phase === "failed"
                        ? "Try preparation again"
                        : `Prepare my ${noun}`}
                      <span aria-hidden="true">→</span>
                    </button>
                    <p className="action-caption">
                      Internet required · 25 GB free for a new download
                    </p>
                  </>
                )}
              </div>
              {!active && device && !completed && (
                <div className="consequence">
                  <span className="small-lock" aria-hidden="true" />
                  <p>
                    <strong>Erase removes all device data.</strong> Activation
                    Lock remains; setup may need the linked Apple Account.
                  </p>
                </div>
              )}
              {needsRecovery && job.phase === "ready" && (
                <p className="recovery-note" role="status">
                  {job.message}
                </p>
              )}
            </div>
          </div>
          <div className="surface-footer">
            <span>
              <span className={`status-dot ${device ? "online" : ""}`} />
              {active
                ? "Keep this app open"
                : completed
                  ? "Restore engine finished"
                  : device
                    ? "Device detected"
                    : "Detection is automatic"}
            </span>
            <span>
              {ready
                ? "Signed firmware checked"
                : active
                  ? "Local device operation"
                  : "You control the erase"}
            </span>
          </div>
        </section>
        <div className="below-surface">
          <span className="privacy-note">Device logs stay on this Mac.</span>
          {(device || job.lines.length > 0) && (
            <details className="technical-details">
              <summary>Device &amp; operation details</summary>
              <div className="technical-content">
                {device && (
                  <p>
                    {device.product} · ECID {device.ecid}
                  </p>
                )}
                {firmware && <p>Firmware: {firmware}</p>}
                {job.message && <p>{job.message}</p>}
                {job.lines.length > 0 && (
                  <pre tabIndex={0} aria-label="Local engine output">
                    {job.lines.join("\n")}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
        <footer>
          <span>PwnMyFone · macOS development build</span>
          <span>Screen passcode recovery through erase &amp; restore</span>
        </footer>
      </main>
      {confirm && device && canErase && (
        <EraseDialog
          device={device}
          disabled={active}
          error={error}
          onDismiss={dismissReview}
          onErase={(phrase) => action("erase_restore", phrase)}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

use serde::Serialize;
use std::{
    collections::VecDeque,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Manager, WindowEvent};

#[derive(Clone, Serialize, Debug)]
struct Device {
    ecid: String,
    name: String,
    mode: String,
    product: Option<String>,
    #[serde(skip)]
    udid: Option<String>,
}
#[derive(Clone, Serialize, Default)]
struct Job {
    phase: String,
    running: bool,
    ecid: Option<String>,
    message: String,
    lines: VecDeque<String>,
    progress: Option<(String, f64)>,
    receipt: bool,
}
#[derive(Default)]
struct Engine {
    job: Job,
    prepared: Option<(String, PathBuf)>,
}
type Shared = Arc<Mutex<Engine>>;
#[derive(Serialize)]
struct Snapshot {
    devices: Vec<Device>,
    ready: bool,
    issue: Option<String>,
}

fn helper(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    let path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("helpers")
        .join(name);
    if !path.is_file() {
        return Err(format!(
            "Missing bundled {name} engine. This build cannot restore devices."
        ));
    }
    Ok(path)
}
fn output(path: &Path, args: &[&str]) -> Result<String, String> {
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("Missing stdout")?;
    let err = child.stderr.take().ok_or("Missing stderr")?;
    let a = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = out.take(1024 * 1024).read_to_string(&mut s);
        s
    });
    let b = std::thread::spawn(move || {
        let mut s = String::new();
        let _ = err.take(1024 * 1024).read_to_string(&mut s);
        s
    });
    let start = Instant::now();
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) => {
                let stdout = a.join().unwrap_or_default();
                let stderr = b.join().unwrap_or_default();
                return if status.success() {
                    Ok(stdout)
                } else {
                    Err(format!("{} {}", stdout, stderr)
                        .trim()
                        .chars()
                        .take(300)
                        .collect())
                };
            }
            None if start.elapsed() > Duration::from_secs(8) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = a.join();
                let _ = b.join();
                return Err("Device query timed out. Check the cable and recovery mode.".into());
            }
            _ => std::thread::sleep(Duration::from_millis(50)),
        }
    }
}
fn field(text: &str, key: &str) -> Option<String> {
    text.lines().find_map(|line| {
        line.strip_prefix(&format!("{key}: "))
            .map(|v| v.trim().to_string())
    })
}
fn valid_ecid(value: &str) -> bool {
    value.parse::<u64>().is_ok_and(|v| v > 0)
}
fn usb_devices(value: &plist::Value, found: &mut Vec<(Device, Option<String>)>) {
    if let Some(array) = value.as_array() {
        for v in array {
            usb_devices(v, found);
        }
    }
    if let Some(d) = value.as_dictionary() {
        if d.get("idVendor")
            .and_then(plist::Value::as_unsigned_integer)
            == Some(1452)
        {
            let pid = d
                .get("idProduct")
                .and_then(plist::Value::as_unsigned_integer)
                .unwrap_or(0);
            let name = d
                .get("USB Product Name")
                .and_then(plist::Value::as_string)
                .unwrap_or("Apple device");
            let mode = match pid {
                0x1280..=0x1283 => "Recovery",
                0x1227 => "DFU",
                0x12a0..=0x12af => "Normal",
                _ => "Unsupported",
            };
            let serial = d.get("USB Serial Number").and_then(plist::Value::as_string);
            let ecid = d
                .get("UsbAppleDeviceECID")
                .and_then(plist::Value::as_unsigned_integer)
                .or_else(|| {
                    serial.and_then(|s| {
                        s.split_whitespace().find_map(|part| {
                            part.strip_prefix("ECID:")
                                .and_then(|n| u64::from_str_radix(n, 16).ok())
                        })
                    })
                });
            if mode != "Unsupported" {
                if let Some(ecid) = ecid.filter(|v| *v > 0) {
                    found.push((
                        Device {
                            ecid: ecid.to_string(),
                            name: name.into(),
                            mode: mode.into(),
                            product: None,
                            udid: if mode == "Normal" {
                                serial.map(str::to_owned)
                            } else {
                                None
                            },
                        },
                        serial.map(str::to_owned),
                    ));
                }
            }
        }
        for v in d.values() {
            usb_devices(v, found);
        }
    }
}
fn scan(app: &tauri::AppHandle) -> Result<Vec<Device>, String> {
    if !cfg!(target_os = "macos") {
        return Err(
            "Device operations are enabled on macOS only in this development build.".into(),
        );
    }
    let xml = output(
        Path::new("/usr/sbin/ioreg"),
        &["-r", "-c", "IOUSBHostDevice", "-a"],
    )?;
    let value = plist::Value::from_reader_xml(xml.as_bytes())
        .map_err(|e| format!("USB inventory unavailable: {e}"))?;
    let mut found = Vec::new();
    usb_devices(&value, &mut found);
    let mut devices = Vec::new();
    for (mut d, serial) in found {
        if devices.iter().any(|v: &Device| v.ecid == d.ecid) {
            continue;
        }
        if d.mode == "Recovery" || d.mode == "DFU" {
            if let Ok(tool) = helper(app, "irecovery") {
                if let Ok(info) = output(&tool, &["-i", &d.ecid, "-q"]) {
                    d.product = field(&info, "PRODUCT");
                    if let Some(name) = field(&info, "NAME") {
                        d.name = name;
                    }
                }
            }
        } else if let (Some(serial), Ok(tool)) = (serial, helper(app, "ideviceinfo")) {
            if let Ok(product) = output(&tool, &["-s", "-u", &serial, "-k", "ProductType"]) {
                let p = product.trim();
                if p.starts_with("iPad") || p.starts_with("iPhone") {
                    d.product = Some(p.into());
                }
            }
        }
        devices.push(d);
    }
    Ok(devices)
}
fn target(app: &tauri::AppHandle, ecid: &str, recovery: bool) -> Result<Device, String> {
    if !valid_ecid(ecid) {
        return Err("Invalid device identity.".into());
    }
    let d = scan(app)?
        .into_iter()
        .find(|d| d.ecid == ecid)
        .ok_or("The selected device is disconnected. Reconnect it and scan again.")?;
    if !d
        .product
        .as_ref()
        .is_some_and(|p| p.starts_with("iPad") || p.starts_with("iPhone"))
    {
        return Err(
            "Could not identify a supported iPad or iPhone. Enter recovery mode and try again."
                .into(),
        );
    }
    if recovery && d.mode != "Recovery" {
        return Err(
            "Enter recovery mode before erasing. DFU restores are not enabled in this build."
                .into(),
        );
    }
    if !recovery && d.mode != "Normal" && d.mode != "Recovery" {
        return Err("Use normal or recovery mode for firmware preparation.".into());
    }
    Ok(d)
}
#[tauri::command]
async fn device_snapshot(app: tauri::AppHandle) -> Result<Snapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let issue = helper(&app, "idevicerestore").err();
        scan(&app).map(|devices| Snapshot {
            devices,
            ready: issue.is_none(),
            issue,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
fn job_status(state: tauri::State<'_, Shared>) -> Result<Job, String> {
    Ok(state.lock().map_err(|_| "Engine lock failed")?.job.clone())
}
fn line(state: &Shared, text: String) {
    if let Ok(mut s) = state.lock() {
        let clean: String = text
            .chars()
            .filter(|c| !c.is_control() || *c == '\t')
            .take(700)
            .collect();
        if !clean.trim().is_empty() {
            if let Some((label, value)) = clean.rsplit_once(':') {
                if matches!(
                    label,
                    "Downloading" | "Verifying" | "Extracting" | "Uploading"
                ) {
                    if let Ok(value) = value.trim().parse::<f64>() {
                        if value.is_finite() && (0.0..=1.0).contains(&value) {
                            s.job.progress = Some((label.into(), value * 100.0));
                        }
                    }
                }
            }
            if clean.contains("Status: Restore Finished") {
                s.job.receipt = true;
                s.job.message =
                    "Restore engine reported completion; waiting for process exit.".into();
            }
            if s.job.lines.back() != Some(&clean) {
                s.job.lines.push_back(clean);
            }
            while s.job.lines.len() > 120 {
                s.job.lines.pop_front();
            }
        }
    }
}
fn run_process(mut cmd: Command, state: &Shared) -> Result<(), String> {
    let mut child = cmd
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let out = child.stdout.take().ok_or("Missing restore output")?;
    let err = child.stderr.take().ok_or("Missing restore errors")?;
    let s = state.clone();
    let a = std::thread::spawn(move || {
        for item in BufReader::new(out).lines() {
            match item {
                Ok(v) => line(&s, v),
                Err(_) => break,
            }
        }
    });
    let s = state.clone();
    let b = std::thread::spawn(move || {
        for item in BufReader::new(err).lines() {
            match item {
                Ok(v) => line(&s, v),
                Err(_) => break,
            }
        }
    });
    let result = child.wait().map_err(|e| e.to_string());
    let _ = a.join();
    let _ = b.join();
    if result?.success() {
        Ok(())
    } else {
        Err("The restore engine failed. Review its output below. The device may need recovery mode again; do not assume it was restored.".into())
    }
}
fn cache(app: &tauri::AppHandle, ecid: &str, preparing: bool) -> Result<PathBuf, String> {
    let p = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("firmware")
        .join(ecid);
    std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
    // A cached package can be revalidated without reserving its download size
    // again. The engine still checks its checksum and current signed selection.
    let cached = std::fs::read_dir(&p)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .any(|e| e.path().extension().is_some_and(|v| v == "ipsw"));
    let required = if preparing && !cached { 25 } else { 15 };
    if fs2::available_space(&p).map_err(|e| e.to_string())? < required * 1024 * 1024 * 1024 {
        return Err(format!(
            "At least {required} GB of free space is required for this operation."
        ));
    }
    Ok(p)
}
fn reserve(state: &Shared, ecid: &str, phase: &str) -> Result<(), String> {
    let mut s = state.lock().map_err(|_| "Engine lock failed")?;
    if s.job.running {
        return Err("An operation is already running.".into());
    }
    if phase == "preparing" {
        s.prepared = None;
    }
    s.job = Job {
        phase: phase.into(),
        running: true,
        ecid: Some(ecid.into()),
        message: if phase == "preparing" {
            "Downloading and checking signed firmware. This does not erase your device.".into()
        } else if phase == "recovering" {
            "Requesting recovery mode. Your device will restart; this does not erase data.".into()
        } else {
            "Erasing and restoring. Keep the device connected and this app open.".into()
        },
        lines: VecDeque::new(),
        progress: None,
        receipt: false,
    };
    Ok(())
}
fn finish(state: &Shared, result: Result<Option<PathBuf>, String>, ecid: String, restore: bool) {
    if let Ok(mut s) = state.lock() {
        s.job.running = false;
        match result {
            Ok(path) => {
                if let Some(path) = path {
                    s.prepared = Some((ecid, path));
                    s.job.phase = "ready".into();
                    s.job.message="Firmware downloaded and checked. Enter recovery mode, then review the erase confirmation.".into();
                } else {
                    s.prepared = None;
                    s.job.phase = "complete".into();
                    s.job.message="Restore completed according to the engine. Check that your device shows the Hello setup screen. Activation Lock may require your Apple Account.".into();
                }
            }
            Err(e) => {
                s.job.phase = "failed".into();
                s.job.message = e;
                if restore {
                    s.prepared = None;
                }
            }
        }
    }
}
#[tauri::command]
fn prepare_firmware(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    ecid: String,
) -> Result<(), String> {
    if !valid_ecid(&ecid) {
        return Err("Invalid device identity".into());
    }
    let shared = state.inner().clone();
    reserve(&shared, &ecid, "preparing")?;
    std::thread::spawn(move || {
        let result = (|| {
            target(&app, &ecid, false)?;
            let dir = cache(&app, &ecid, true)?;
            let tool = helper(&app, "idevicerestore")?;
            let mut cmd = Command::new(tool);
            cmd.args([
                "--ecid",
                &ecid,
                "--latest",
                "--no-input",
                "--no-action",
                "--plain-progress",
                "--logfile",
                "NONE",
                "--cache-path",
            ])
            .arg(&dir)
            .current_dir(&dir);
            run_process(cmd, &shared)?;
            let paths: Vec<PathBuf> = std::fs::read_dir(&dir)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| p.extension().is_some_and(|e| e == "ipsw"))
                .collect();
            if paths.len() != 1 {
                return Err("Firmware cache is ambiguous. The app will not choose a firmware file for erase. Review the local firmware cache before retrying.".into());
            }
            Ok(Some(paths[0].clone()))
        })();
        match result {
            Ok(Some(path)) => {
                if let Ok(mut s) = shared.lock() {
                    s.prepared = Some((ecid.clone(), path));
                    s.job.phase = "recovering".into();
                    s.job.progress = None;
                    s.job.message = "Firmware checked. Automatically requesting recovery mode; no data is being erased.".into();
                }
                let recovery = request_recovery(&app, &ecid);
                if let Ok(mut s) = shared.lock() {
                    s.job.running = false;
                    s.job.phase = "ready".into();
                    s.job.message = recovery.map(|_| "Firmware ready and recovery mode verified. Review the erase confirmation when ready.".to_string()).unwrap_or_else(|e| format!("Firmware ready. {e}"));
                }
            }
            other => finish(&shared, other, ecid, false),
        }
    });
    Ok(())
}
fn request_recovery(app: &tauri::AppHandle, ecid: &str) -> Result<(), String> {
    let device = target(app, ecid, false)?;
    if device.mode == "Recovery" {
        return Ok(());
    }
    let udid = device
        .udid
        .ok_or("Device connection identity unavailable. Use the button instructions.")?;
    if !udid.chars().all(|c| c.is_ascii_hexdigit() || c == '-') || udid.len() < 20 {
        return Err("Invalid USB identity. Use the button instructions.".into());
    }
    output(&helper(app, "ideviceenterrecovery")?, &[&udid]).map_err(|e| {
        format!("Automatic recovery was refused: {e}. Use the button instructions.")
    })?;
    let start = Instant::now();
    while start.elapsed() < Duration::from_secs(40) {
        if scan(app)?
            .iter()
            .any(|d| d.ecid == ecid && d.mode == "Recovery")
        {
            return Ok(());
        }
        std::thread::sleep(Duration::from_secs(1));
    }
    Err("Recovery request sent, but the same device has not returned in recovery mode. Check the cable or use the button instructions.".into())
}
#[tauri::command]
fn enter_recovery(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    ecid: String,
) -> Result<(), String> {
    if !valid_ecid(&ecid) {
        return Err("Invalid device identity".into());
    }
    let shared = state.inner().clone();
    reserve(&shared, &ecid, "recovering")?;
    std::thread::spawn(move || {
        let result = request_recovery(&app, &ecid);
        if let Ok(mut s) = shared.lock() {
            s.job.running = false;
            s.job.phase = if s.prepared.as_ref().is_some_and(|(id, _)| id == &ecid) {
                "ready"
            } else {
                "recovery"
            }
            .into();
            s.job.message = match result {
                Ok(()) => {
                    "Recovery mode verified for the selected device. No data has been erased."
                        .into()
                }
                Err(e) => e,
            };
        }
    });
    Ok(())
}
#[tauri::command]
fn erase_restore(
    app: tauri::AppHandle,
    state: tauri::State<'_, Shared>,
    ecid: String,
    confirmation: String,
) -> Result<(), String> {
    if confirmation != "ERASE" || !valid_ecid(&ecid) {
        return Err("Type ERASE to confirm permanent removal of all data from this device.".into());
    }
    let shared = state.inner().clone();
    let firmware = {
        let s = shared.lock().map_err(|_| "Engine lock failed")?;
        s.prepared
            .as_ref()
            .filter(|(id, path)| id == &ecid && path.is_file())
            .map(|(_, p)| p.clone())
            .ok_or("Prepare firmware for this device before erasing.")?
    };
    reserve(&shared, &ecid, "restoring")?;
    std::thread::spawn(move || {
        let result = (|| {
            target(&app, &ecid, true)?;
            let dir = cache(&app, &ecid, false)?;
            let tool = helper(&app, "idevicerestore")?;
            let mut cmd = Command::new(tool);
            cmd.args([
                "--ecid",
                &ecid,
                "--erase",
                "--no-input",
                "--plain-progress",
                "--logfile",
                "NONE",
                "--cache-path",
            ])
            .arg(&dir)
            .arg(firmware)
            .current_dir(&dir);
            run_process(cmd, &shared)?;
            if !shared.lock().map_err(|_| "Engine lock failed")?.job.receipt {
                return Err("The engine exited without a restore-completion receipt. Check the iPad; success is unverified.".into());
            }
            Ok(None)
        })();
        finish(&shared, result, ecid, true);
    });
    Ok(())
}
// Cocoa's native Quit (including Dock Quit) bypasses Tauri's ExitRequested.
// Add the delegate's documented termination veto and consult the same job state.
#[cfg(target_os = "macos")]
mod native_quit {
    use super::Shared;
    use std::{
        ffi::{c_char, c_void},
        sync::OnceLock,
    };
    static STATE: OnceLock<Shared> = OnceLock::new();
    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const c_char) -> *mut c_void;
        fn sel_registerName(name: *const c_char) -> *mut c_void;
        #[link_name = "objc_msgSend"]
        fn send(receiver: *mut c_void, selector: *mut c_void) -> *mut c_void;
        fn object_getClass(object: *mut c_void) -> *mut c_void;
        fn class_addMethod(
            class: *mut c_void,
            selector: *mut c_void,
            implementation: unsafe extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> isize,
            types: *const c_char,
        ) -> bool;
    }
    unsafe extern "C" fn should_terminate(_: *mut c_void, _: *mut c_void, _: *mut c_void) -> isize {
        // NSTerminateCancel = 0, NSTerminateNow = 1. Fail closed if poisoned.
        if STATE
            .get()
            .is_some_and(|s| s.lock().map(|v| v.job.running).unwrap_or(true))
        {
            0
        } else {
            1
        }
    }
    pub fn install(state: Shared) -> Result<(), String> {
        STATE
            .set(state)
            .map_err(|_| "Termination guard already installed")?;
        // Called from Tauri setup on the Cocoa main thread. NSObject references
        // are borrowed only here; the delegate owns their lifetime.
        unsafe {
            let application = send(
                objc_getClass(c"NSApplication".as_ptr()),
                sel_registerName(c"sharedApplication".as_ptr()),
            );
            let delegate = send(application, sel_registerName(c"delegate".as_ptr()));
            if delegate.is_null()
                || !class_addMethod(
                    object_getClass(delegate),
                    sel_registerName(c"applicationShouldTerminate:".as_ptr()),
                    should_terminate,
                    c"q@:@".as_ptr(),
                )
            {
                return Err("Could not install native termination guard".into());
            }
        }
        Ok(())
    }
}
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let state: Shared = Arc::new(Mutex::new(Engine::default()));
    tauri::Builder::default()
        .manage(state)
        .setup(|app| {
            #[cfg(target_os = "macos")]
            native_quit::install(app.state::<Shared>().inner().clone())
                .map_err(std::io::Error::other)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            device_snapshot,
            job_status,
            prepare_firmware,
            erase_restore,
            enter_recovery
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.state::<Shared>().lock().is_ok_and(|s| s.job.running) {
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building PwnMyFone")
        .run(|app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                if app.state::<Shared>().lock().is_ok_and(|s| s.job.running) {
                    api.prevent_exit();
                }
            }
        });
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifies_recovery_ecid_without_rounding() {
        let mut d = plist::Dictionary::new();
        d.insert("idVendor".into(), 1452u64.into());
        d.insert("idProduct".into(), 0x1281u64.into());
        d.insert(
            "USB Serial Number".into(),
            "CPID:8011 ECID:FFFFFFFFFFFFFFFE".into(),
        );
        let mut found = Vec::new();
        usb_devices(&plist::Value::Dictionary(d), &mut found);
        assert_eq!(found[0].0.ecid, "18446744073709551614");
        assert_eq!(found[0].0.mode, "Recovery");
    }
    #[test]
    fn single_operation_guard() {
        let s = Arc::new(Mutex::new(Engine::default()));
        reserve(&s, "123", "preparing").unwrap();
        assert!(reserve(&s, "456", "restoring").is_err());
    }
    #[test]
    fn rejects_zero_and_argument_injection() {
        assert!(!valid_ecid("0"));
        assert!(!valid_ecid("123 --erase"));
        assert!(valid_ecid("123456789"));
    }
    #[test]
    fn receipt_survives_log_rotation_and_progress_is_a_percentage() {
        let state = Arc::new(Mutex::new(Engine::default()));
        line(&state, "Downloading: 0.5".into());
        assert_eq!(
            state.lock().unwrap().job.progress,
            Some(("Downloading".into(), 50.0))
        );
        line(&state, "Status: Restore Finished".into());
        for i in 0..150 {
            line(&state, format!("Later log {i}"));
        }
        let state = state.lock().unwrap();
        assert!(state.job.receipt);
        assert_eq!(state.job.lines.len(), 120);
    }
}

#[tauri::command]
fn device_engine_status() -> &'static str {
    "Rust engine connected. Device detection is not implemented yet; no device was scanned."
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![device_engine_status])
        .run(tauri::generate_context!())
        .expect("error while running PwnMyFone");
}

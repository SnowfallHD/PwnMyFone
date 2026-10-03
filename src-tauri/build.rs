fn main() {
    // ICNS is the canonical macOS application icon. Tauri codegen also needs
    // decoded PNG pixels for its internal cross-platform window-icon context.
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rerun-if-changed=icons/PwnMyFone.icns");
        let status = std::process::Command::new("/usr/bin/sips")
            .args([
                "-s",
                "format",
                "png",
                "--resampleHeightWidth",
                "256",
                "256",
                "icons/PwnMyFone.icns",
                "--out",
                "icons/icon.png",
            ])
            .status()
            .expect("sips is required to decode the ICNS icon");
        assert!(status.success(), "ICNS icon decoding failed");
    }
    tauri_build::build()
}

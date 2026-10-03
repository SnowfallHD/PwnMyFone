# PwnMyFone

A Tauri 2 desktop device toolkit with a Rust backend and React/TypeScript interface. Targets macOS and Windows; device operations in this development build are enabled only on macOS.

## Current workflow

- Automatically detect USB-connected iPads/iPhones and show model, ECID, and normal/recovery mode.
- Download and verify currently signed firmware through the existing idevicerestore engine, without erasing the device.
- Guide one step at a time with animated connection feedback, readable progress, and iPad/iPhone recovery instructions when needed.
- Require firmware preparation for the same device, recovery mode, and an explicit `ERASE` confirmation before starting an erase restore.
- Show live engine output and phase progress. Prevent ordinary window closing and app quitting while an operation is running.

**Erase restore permanently removes device data and its screen passcode. It does not remove Activation Lock.** A linked Apple Account may be required during setup. Keep the device charged, USB connected, and the app open. Do not force-quit or shut down the Mac during a restore.

A successful build or download is not a completed restore. The engine must report its restore-completion receipt and exit successfully; verify the Hello setup screen on the actual device afterward. Do not restore a backup unless you intend to recover its contents/settings.

## macOS development (Apple Silicon)

Install Node.js (22.12+ or a supported newer LTS), Rust via rustup, Xcode command-line tools, and Homebrew. Close the app before rebuilding its helpers.

```sh
npm ci
./scripts/build-macos-engine.sh
npm run tauri dev
```

The engine script pins the upstream restore engine, enables TLS certificate validation for its downloads, disables limera1n support, and bundles native helpers with relative library paths. Source and compiled helpers stay in ignored `.tools/` and `src-tauri/helpers/` directories.

```sh
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri build -- --debug --bundles app
```

The local debug bundle is generated at `src-tauri/target/debug/bundle/macos/PwnMyFone.app`. It is not a signed/notarized public release. Windows device tooling, packaging, and restore behavior remain unqualified.

## Icons

`src-tauri/icons/PwnMyFone.icns` is the macOS application icon used by the bundle and Dock. The editable vector artwork is `app-icon.svg`; regenerate ICNS with `./scripts/build-macos-icon.sh` (requires ImageMagick). Tauri requires decoded PNG pixels for its internal window-icon context; `build.rs` generates that ignored compile-time file from the ICNS. The interface uses vector/CSS illustrations, not PNG app-icon assets. Windows will require its own native ICO packaging when that platform is qualified.

## References and privacy

See [restore workflow references](docs/restore-workflow.md) for Apple, Tenorshare, LockWiper, iMazing, and upstream engine documentation. Firmware is cached under the app's macOS cache directory. Engine output stays local and no telemetry is configured. Standard Apple signing/personalization contacts Apple during restoration. Third-party licensing/source obligations must be resolved before distributing bundled helpers publicly.

Automatic recovery: after firmware verification, the app requests a non-erasing recovery restart for the selected USB device and verifies the same ECID returns in Recovery mode. An Enter recovery now button supports retries; manual iPad instructions remain as fallback when the device refuses the command. Detection alone never restarts or erases an attached device.

Interface craft and validation boundaries are documented in [interface polish](docs/interface-polish.md). The completed restore screen asks the user to verify Hello on the physical device; the app does not detect that screen itself.

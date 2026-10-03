# Restore workflow references

Reviewed 2026-10-03. These are public workflow references, not evidence of proprietary internals or guaranteed device compatibility.

- [Tenorshare 4uKey guide](https://www.tenorshare.com/guide/remove-iphone-passcode.html): automatic USB detection, recovery guidance, firmware download, then screen-passcode removal through erasure. Adopt the staged device/firmware/restore flow.
- [iMyFone LockWiper guide](https://www.imyfone.com/unlock-iphone-passcode/guide/): device/model identification, firmware verification, separate final confirmation, sufficient power, and uninterrupted USB connection. PwnMyFone uses the explicit word ERASE rather than a numeric confirmation.
- [iMazing reinstall guide](https://imazing.com/guides/how-to-reinstall-or-restore-ios-on-a-malfunctioning-iphone-or-ipad): distinguish a data-preserving reinstall from an erase restore and match firmware to the exact device. This lane implements only erase restore; it makes no data-preservation claim.
- [Apple iPad passcode reset](https://support.apple.com/en-us/119858): erase removes the passcode; button instructions vary by model. Recovery mode may expire during a long download, so complete the download and enter recovery again before restore.
- [idevicerestore](https://github.com/libimobiledevice/idevicerestore): existing firmware restore engine, ECID targeting, download-only `--no-action`, signed firmware selection, cache, plain progress, and process result. PwnMyFone never invokes experimental exploit, custom firmware, ignored-error, or system-daemon-disabling options.

## Current implementation boundaries

macOS device operations only. iPad/iPhone identification and ECID must be available. Erasure is permitted only from recovery mode, with prepared firmware for the same ECID and an explicit ERASE confirmation. A single-operation guard prevents concurrent jobs. An exit code alone does not establish restore success: the engine must also report `Status: Restore Finished`, and the user must verify the device's setup screen.

Firmware metadata uses the engine's IPSW.me integration, downloads use its selected firmware URL, checksum verification uses the engine's expected checksum, and installation still requires Apple's signing process. Device-identifying information is sent to Apple as part of standard firmware personalization during restore. Engine output stays local; no application telemetry is configured.

The bundled helper is built from upstream commit `68e5dc907efcbca70747f9ce2cc5975f8ae8b72d`. Its download code is patched to require TLS certificate validation, and limera1n support is disabled. Helpers and their dynamically linked dependencies are local ignored build artifacts. Public redistribution requires preserving applicable upstream licenses and source/relinking obligations, plus separate Windows packaging and platform testing. This is a local development app, not a qualified public release.

## Automatic recovery

Uses libimobiledevice’s [ideviceenterrecovery](https://github.com/libimobiledevice/libimobiledevice/blob/master/tools/ideviceenterrecovery.c), which sends the lockdown recovery request to the selected USB UDID. The backend rechecks the ECID/UDID mapping before requesting and requires that same ECID return in Recovery mode before reporting success. A timeout or connection refusal retains prepared firmware and shows manual instructions. This restart does not erase data. Live check on the connected iPad Pro 10.5-inch (iPad7,3) accepted the command; Finder and irecovery subsequently confirmed Recovery mode. No erase was performed.

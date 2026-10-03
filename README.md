# PwnMyFone

A cross-platform desktop device utility planned for macOS and Windows.

## Planned stack

- Tauri 2
- Rust device engine
- React and TypeScript interface

## Initial scope

Detect connected iPhones and iPads, display device information and connection mode, and build toward a guided firmware erase-and-restore workflow.

The scaffold includes a desktop window and a frontend-to-Rust engine status command. Device detection and restore functionality are not implemented yet; the status command does not scan USB devices.

## Development

Install Node.js (22.12+ or a supported newer LTS), Rust via rustup, and the platform's Tauri prerequisites (Xcode command-line tools on macOS; Microsoft C++ build tools and WebView2 on Windows).

```sh
npm ci
npm run tauri dev
```

`npm run build` checks TypeScript and builds the frontend. `npm run tauri build` produces the desktop release bundle. Device operations belong in the Rust backend; the frontend currently has only core window permissions and the read-only engine status command.

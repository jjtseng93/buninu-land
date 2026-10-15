# Buninu Land

- This is a headless, software-rendered Wayland compositor, running directly in Bun.
- Source/runtime must be JS/TS/WASM. No build step or native addons. The only external native library allowed through Bun FFI is libc.
- Ask the user before installing any dependency. Existing buninu-browser JS/WASM/fonts may be reused.
- Protocol definitions and behavior should follow ../Hyprland as closely as practical. Standard XML is vendored unchanged and parsed at runtime with Bun.XML.
- vendor/buninu-browser/cdp-server.js preserves the byte-for-byte browser original. lib/cdp-server.js has two notified optional raw-input hooks, recorded in patches/cdp-input.patch. Tell the user before further changes; prefer adapting the compositor context.
- Casty is the first frontend, using CASTY_BROWSER=/absolute/path/to/compositor.js.
- First milestone: real weston-simple-shm animation. Do not imply full desktop, input, or general Wayland compatibility.
- Prefer Bun built-ins. Inform the user of unnecessary image encoding, decoding, channel conversions, or copies discovered in the display path.
- Run bun test for protocol/rendering/transport changes. Do not install test prerequisites automatically.

- index.js is the package launcher adapted from buninu-browser; keep its npx/bunx/bun x flow and native frontend placeholders aligned with the browser. compositor.js is the CASTY_BROWSER engine entry.
- Default socket directory: explicit XDG_RUNTIME_DIR, then TMPDIR, then system temporary directory.
- Keep package.json free of a files allowlist. Bundle license notices for all redistributed components.
- Ask questions in plain text; the user's terminal cannot operate option-selection widgets.

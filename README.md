# Buninu Land

English | [繁體中文](README.zh.md)

A Wayland compositor in JavaScript and WebAssembly for Bun

> **Warning:** This project is still in very early development. Features are incomplete, and behavior and APIs may change significantly. It is not ready for everyday use.

A Wayland compositor that runs directly in Bun. The first version supports headless software compositing, with animation verified using the system's `weston-simple-shm`, along with Casty's launch, CDP setup, and frame reception flows. There is no build step, npm runtime dependency, or GPU rendering path.

## Running

Requires 64-bit Linux or Android (aarch64 or x86_64) and a Bun runtime providing `Bun.XML`, `Bun.Image`, and `bun:ffi`. When `process.platform === 'android'`, it loads Bionic's `libc.so` and `__errno`; on Linux, it prefers `libc.so.6` and `__errno_location`. Testing has covered Linux aarch64 with Bun 1.4.3-canary.1. Native Android operation has also been verified by the project author.

Run the project entry point to launch Casty, which then starts the compositor:

```sh
bun index.js
```

Both the package and the global command are named `buninu-land`. Once published to npm, it can be used as follows:

```sh
npm install -g buninu-land
buninu-land
# Or run without a global installation:
npx buninu-land
bunx buninu-land
bun x buninu-land
```

Bun must already be installed. The launcher follows the browser's selection order: use npx when both npx and bun are on PATH, otherwise bunx, otherwise bun x. The Casty package is [`@drxiaozhi/casty`](https://www.npmjs.com/package/@drxiaozhi/casty) ([source on GitHub](https://github.com/jjtseng93/casty)); the package runner may download it if it is not installed or cached. npx retains its installation prompt; the launcher does not add `--yes`.

On the first `npx buninu-land` run after publication, npx obtains Buninu Land,
then the launcher automatically downloads the terminal frontend
[`@drxiaozhi/casty`](https://www.npmjs.com/package/@drxiaozhi/casty)
([source on GitHub](https://github.com/jjtseng93/casty)) if needed.
`bun index.js` uses the same package-based Casty launcher. A headless launch does not fetch Casty.

`--casty` selects the default frontend; `--headless` runs only the compositor. `--win32`, `--gtk`, `--appkit`, and `--qt` preserve the browser's native UI placeholders. They currently report that the frontend is not implemented and exit with status 2. The first argument selects the frontend; all remaining arguments are forwarded unchanged.

```sh
bun index.js --help       # Or -h
bun index.js --version    # Or -V
bun index.js --readme
bun index.js --readme-zh  # Or --docs
bun index.js --headless --help
bun index.js --casty --help
```

You can also launch it through Casty yourself:

```sh
export CASTY_BROWSER="$PWD/compositor.js"
bunx @drxiaozhi/casty about:blank
```

The socket directory is chosen in this order: an explicitly set `$XDG_RUNTIME_DIR`, `$TMPDIR`, then the system temporary directory. The socket is placed directly in that directory, with no additional subdirectory. Its default name is `wayland-buninu`. For example, in another terminal:

```sh
WAYLAND_DISPLAY="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/wayland-buninu" weston-simple-shm
```

For Konsole, explicitly select Qt’s Wayland backend with `QT_QPA_PLATFORM=wayland` to avoid starting with the wrong platform backend. In another terminal, use the same socket directory as the compositor:

```sh
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
export WAYLAND_DISPLAY=wayland-buninu
QT_QPA_PLATFORM=wayland konsole
```

Konsole startup and rendering have been verified. Keyboard and mouse input are not implemented yet, so the window can display output but cannot yet be used as an interactive terminal through Casty.

Casty passes `--remote-debugging-port=0`, allowing the system to select an available port. It reads the actual port from the compositor's DevTools URL output. A manual headless launch defaults to port 9222.

Chromium compatibility flags passed by Casty, such as `--no-sandbox`, `--user-data-dir`, and `--disable-*`, are currently ignored. `--remote-debugging-port` and `--window-size` take effect.

To run headless directly:

```sh
bun compositor.js --headless --remote-debugging-port=9222
```

Choose either a manual headless launch or a Casty-managed launch to avoid occupying the same socket. URLs supplied to Casty do not open web pages; the display shows the Wayland desktop.

Run `bun compositor.js --help` for options. The default socket is `wayland-buninu`, and the default display size is 800×600. Use `--socket=NAME` to select another socket or `--remote-debugging-port=0` to select a port automatically. `BUNINU_LOG=1` writes Wayland requests to stderr.

## Updating and clearing cached packages

To request the latest published Buninu Land explicitly, run `npx buninu-land@latest`.
Casty is resolved separately by the selected package runner; clearing only the
Buninu Land cache does not clear Casty's cache. Casty prints its version when it exits.

To reinstall cached copies, use the cache-management commands below. For npm 11
or later, list entries and remove the keys shown for `buninu-land` and
`@drxiaozhi/casty` (replace the placeholders with your actual keys):

```sh
npm cache npx ls
npm cache npx rm <buninu-land-key> <casty-key>

# Alternatively, clear all npx entries, including other tools:
npm cache npx rm --force

# If the launcher uses bunx or bun x, clear Bun's package cache:
bun pm cache rm
```

For older npm versions, run `npm config get cache` and remove the `_npx`
subdirectory inside that location. The usual Linux/Android location is
`~/.npm/_npx`; a custom npm cache setting may change it. Clearing the entire
npx or Bun cache affects other cached packages too. These instructions do not
uninstall global packages. To update a global installation, use
`npm install -g buninu-land@latest`.

References: [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache/),
[Bun package-cache commands](https://bun.sh/docs/pm/cli/pm).

## Structure

- `index.js`: the package launcher adapted from the browser. It starts Casty by default and sets `CASTY_BROWSER` to the compositor.
- `compositor.js`: headless controller, CDP context adapter, lifecycle management, and CLI.
- `lib/cdp-server.js`: copied unchanged from buninu-browser. `user-agent.js` is also unchanged, preserving Buninu's CDP compatibility identity.
- `lib/protocol.js`: reads standard XML at runtime with `Bun.XML.parse()`, preserving opcode and argument order.
- `lib/transport.js`: loads only libc through Bun FFI; handles Unix sockets, `recvmsg`/`SCM_RIGHTS`, nonblocking transport, socket locking, and FD cleanup.
- `lib/compositor.js`: per-client object tables, SHM pool/buffer lifetimes, surface commits, xdg configure/ack, and frame callbacks.
- `lib/renderer.js`: CPU compositing using the browser's CanvasKit WASM. `lib/frame.js` is an unchanged copy of the browser's `Bun.Image` encoding utilities.

At commit time, SHM pixels are copied into compositor-owned memory using libc `pread`, then the client buffer is released. This lets the client safely reuse its buffer and avoids compositor SIGBUS faults caused by clients truncating an mmap backing file. Destroying a pool resource does not close its FD while buffers still reference it.

## First-version scope

Advertises `wl_compositor` v4, `wl_shm` v1, `xdg_wm_base` v1, `wl_output` v2, and `wl_seat` v1. SHM supports ARGB8888 and XRGB8888, with basic xdg_toplevel configure/ack, buffer release, and frame callbacks. Windows are centered and stacked, with scheduling at approximately 60 Hz. Each commit still copies the entire buffer; damage is not yet used for partial redraws.

This is the `weston-simple-shm` milestone, not a complete Wayland compositor. It has no keyboard, mouse, or touch input (seat capabilities are 0), popups, subsurfaces, clipboard, GPU/dmabuf support, window management, or interactive movement/resizing. Maximize/fullscreen requests currently leave sizing to the client; opaque/input regions do not yet affect compositing or input. Casty input is not yet translated into Wayland input events. Comprehensive protocol error and role-lifecycle validation is also incomplete.

Protocol definitions are preserved unchanged, but their implementation is JavaScript, not a byte-for-byte copy of Hyprland's C++. Not every request in the XML is implemented. See `SOURCES.md` for references.

## Frame conversion costs

PNG: SHM BGRA → CanvasKit software compositing → CanvasKit PNG → CDP base64 → Casty decoding. Using CanvasKit's PNG encoder directly avoids intermediate RGBA/BMP conversion.

JPEG/WebP: SHM BGRA → CanvasKit software compositing → RGBA readback → BMP wrapping → Bun.Image decoding/encoding → CDP base64 → Casty decoding. BMP wrapping adds a full-frame copy, and Bun.Image then parses the BMP. This cost comes from reusing the browser's encoding utilities; a future encoding path should accept raw pixels directly. The existing CanvasKit WASM's JPEG encoder does not produce output, so it cannot directly replace this path. Casty also receives low-resolution change notifications before requesting full screenshots, adding encoding work.

## Verification

```sh
bun test
```

Tests cover protocol XML opcodes, FD arguments, fragmented packets, exclusive socket locking, malformed-client isolation, real `weston-simple-shm` animation, and CDP PNG/JPEG output. Tests requiring a Weston client are skipped if it is not installed. Casty integration tests exercise its actual launch/setup/screencast code when the test prerequisites are available; otherwise they are skipped. Dependencies are not installed automatically. Screenshot paths are printed in the test output. Casty tests cover receiving images, but do not automatically verify Kitty graphics display in a terminal.

## Licensing

The project's original code is MIT-licensed; see `LICENSE`. Sources and licenses for the reused browser code, CanvasKit WASM and its embedded components, and Wayland XML are documented in `THIRD_PARTY_NOTICES.md`, `LICENSES/`, and `SOURCES.md`. The project's MIT declaration does not replace third-party licenses.


# Buninu Land

English | [繁體中文](README.zh.md)

A Wayland compositor in JavaScript and WebAssembly for Bun

> **Warning:** This project is still in very early development. Features are incomplete, and behavior and APIs may change significantly. It is not ready for everyday use.

A Wayland compositor that runs directly in Bun. The first version supports headless software compositing, with animation verified using the system's `weston-simple-shm`, along with Casty's launch, CDP setup, and frame reception flows. There is no build step, npm runtime dependency, or compositor GPU rendering path.

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

The socket directory is chosen in this order: an explicitly set `$XDG_RUNTIME_DIR`, `$TMPDIR`, then the system temporary directory. The socket is placed directly in that directory, with no additional subdirectory. It selects the first unlocked name: `wayland-buninu`, `wayland-buninu1`, `wayland-buninu2`, and so on. For example, in another terminal:

```sh
WAYLAND_DISPLAY="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/wayland-buninu" weston-simple-shm
```

Without `--socket`, availability is determined by the kernel’s exclusive `flock`, not by whether a socket file exists. Exit or a crash releases the lock, so stale sockets and gaps in the numbering can be reused. An explicit `--socket=NAME` remains fixed and fails if occupied. Use the actual `WAYLAND_DISPLAY` name/path printed at startup for your clients. For multiple headless instances, add `--remote-debugging-port=0` to allocate CDP ports automatically as well.

For Konsole, explicitly select Qt’s Wayland backend with `QT_QPA_PLATFORM=wayland` to avoid starting with the wrong platform backend. In another terminal, use the same socket directory as the compositor:

```sh
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
export WAYLAND_DISPLAY=wayland-buninu
QT_QPA_PLATFORM=wayland konsole
```

Konsole startup, rendering, keyboard input, and mouse input have been verified.

### Chromium and Firefox

In another terminal, use the same socket directory and name as the compositor. The author verified that Chromium only needs `XDG_RUNTIME_DIR`, `WAYLAND_DISPLAY`, and `--ozone-platform=wayland --no-sandbox`; `--disable-gpu` is not required:

```sh
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
export WAYLAND_DISPLAY=wayland-buninu
chromium --ozone-platform=wayland --no-sandbox
firefox
```

Firefox ESR 140.12.0 was also verified to select Wayland automatically when launched as `firefox` with only the `XDG_RUNTIME_DIR` and `WAYLAND_DISPLAY` settings above; neither `MOZ_ENABLE_WAYLAND` nor `GDK_BACKEND` was needed. `DISPLAY` and `XDG_SESSION_TYPE` were unset during this test, and page rendering, text input, and mouse clicks all passed.

The system-installed Chromium 153.0.8010.52 and Firefox ESR 140.12.0 were tested with real windows, software-rendered pages, text input, and mouse clicks. Tests use isolated profiles and do not download or install browsers. WebGL, video, and general website compatibility have not been verified. Close existing browser instances first to avoid forwarding the command to a process on another desktop.

The Chromium command above uses `--no-sandbox`, which disables the browser sandbox and is only suitable for testing trusted content in an isolated environment, not general browsing. Firefox did not require disabling its sandbox. Native Android browser binaries were not verified in this test.

Firefox's subsurfaces now participate in compositing and pointer coordinate handling. `wl_data_device_manager` currently provides the interface GTK needs to initialize and an empty selection; clipboard and drag-and-drop are not implemented.

Casty passes `--remote-debugging-port=0`, allowing the system to select an available port. It reads the actual port from the compositor's DevTools URL output. A manual headless launch defaults to port 9222.

Chromium compatibility flags passed by Casty, such as `--no-sandbox`, `--user-data-dir`, and `--disable-*`, are currently ignored. `--remote-debugging-port` and `--window-size` take effect.

To run headless directly:

```sh
bun compositor.js --headless --remote-debugging-port=9222
```

Manual headless and Casty-managed instances can coexist with different automatically allocated sockets. URLs supplied to Casty do not open web pages; the display shows the Wayland desktop.

Run `bun compositor.js --help` for options. Default socket allocation starts at `wayland-buninu`, and the default display size is 800×600. Use `--socket=NAME` to select another socket or `--remote-debugging-port=0` to select a port automatically. `BUNINU_LOG=1` writes Wayland requests to stderr.

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
- `lib/cdp-server.js`: browser CDP server with two optional raw-input hooks; the unchanged original is in `vendor/buninu-browser/cdp-server.js`, with the diff in `patches/cdp-input.patch`. `user-agent.js` is also unchanged, preserving Buninu's CDP compatibility identity.
- `lib/protocol.js`: reads standard XML at runtime with `Bun.XML.parse()`, preserving opcode and argument order.
- `lib/transport.js`: loads only libc through Bun FFI; handles Unix sockets, `recvmsg`/`SCM_RIGHTS`, nonblocking transport, socket locking, and FD cleanup.
- `lib/compositor.js`: per-client object tables, SHM pool/buffer lifetimes, surface commits, xdg configure/ack, and frame callbacks.
- `lib/renderer.js`: CPU compositing using the browser's CanvasKit WASM. `lib/frame.js` is an unchanged copy of the browser's `Bun.Image` encoding utilities.

At commit time, SHM pixels are copied into compositor-owned memory using libc `pread`, then the client buffer is released. This lets the client safely reuse its buffer and avoids compositor SIGBUS faults caused by clients truncating an mmap backing file. Destroying a pool resource does not close its FD while buffers still reference it.

## First-version scope

Advertises `wl_compositor` v4, `wl_shm` v1, `xdg_wm_base` v1, `wl_output` v2, `wl_seat` v5 (pointer and keyboard), `wl_subcompositor` v1, and `wl_data_device_manager` v1. SHM supports ARGB8888 and XRGB8888. The first normal window fills the work area with an 8-pixel outer gap; additional windows split the tiled area. Rendering is scheduled at approximately 60 Hz; commits still copy the entire buffer.

Casty mouse/key events now route to Wayland, with a JS-generated XKB keymap, focus, basic popups, and fullscreen configuration. These remain early implementations. Subsurfaces support synchronized/desynchronized commits, positioning, and stacking. Touch, clipboard, drag-and-drop, GPU compositing, general DMA-BUF support, comprehensive popup constraints, and full protocol/role validation are not implemented.

### Window shortcuts

These three bindings follow [Omarchy v3.3.0](https://github.com/basecamp/omarchy/blob/v3.3.0/default/hypr/bindings/tiling-v2.conf), replacing Super with Ctrl+Alt:

| Shortcut | Action |
| --- | --- |
| Ctrl+Alt+Arrow | Focus a window in that direction on the current workspace |
| Ctrl+Alt+W | Request that the focused window close; applications may ask for confirmation |
| Ctrl+Alt+F | Toggle fullscreen; toggle again to restore the layout |

Directional focus while fullscreen transfers fullscreen to the selected window. An arrow with no window in that direction does nothing. Only these three bindings are currently enabled; F6–F9 and the temporary W/arrow/Tab visual probes are removed. Tab combinations pass through to applications. The tested terminal preserves only Shift for Tab, so Ctrl/Alt+Tab is not used for window switching. Restart the compositor to load changes.

Protocol definitions are preserved unchanged, but their implementation is JavaScript, not a byte-for-byte copy of Hyprland's C++. Not every request in the XML is implemented. See `SOURCES.md` for references.

## Frame conversion costs

The renderer caches CanvasKit images for immutable SHM snapshots, reuses one full-size and one preview drawing surface, and reuses composed images while pixels, geometry, stacking, cursor and viewport remain unchanged. Previews reuse an existing matching full image without forcing a full-size repaint. This retains drawing buffers between captures; replaced images and resized buffers are released, and shutdown releases the renderer's resources.

Casty zoom is applied through CDP `deviceScaleFactor`: layout and input retain logical coordinates, while screenshots use physical pixel dimensions. For clients using the resampling fallback, zoom below 1 uses linear image sampling to reduce aliasing when shrinking content. These changes are confined to land; Casty and buninu-browser remain unchanged.

Land advertises `wp_fractional_scale_manager_v1` and `wp_viewporter`. Supporting clients can render buffers at the requested scale while keeping logical window dimensions and input coordinates. Viewport source/destination state is committed with the surface, including synchronized subsurfaces; native-size fractional buffers are aligned to physical pixels to avoid filtering them again. Clients that do not use fractional scaling retain the existing resampling fallback.

Firefox scaling has been checked in two versions:

- **Firefox 153.5.0 ESR:** the running session at Casty zoom 60% used a 667 × 810 logical viewport and a 400 × 486 output. Firefox's shared pixel buffer also contained 400 × 486 pixels; 99.95% of its RGB pixels matched the captured PNG exactly. This confirms that the inspected output preserves the client raster instead of shrinking a larger image. Text looked clearer in the PNG; terminal presentation was not measured, and this was not a repeat of the full browser input suite.
- **Firefox 140.12.0 ESR:** fractional scaling was disabled by default in our test. Setting `widget.wayland.fractional-scale.enabled=true` in `about:config` and restarting enabled native-size content buffers at 60%. Typing, clicking and scrolling passed in an isolated profile. GTK window decorations still used the fallback path in that test.

Clients that do not use fractional scaling still display and receive input through the original logical coordinates, but shrinking their raster can remain blurry. Support can differ between surfaces within one application. Casty zoom and Firefox's own page zoom are separate; page zoom can still make text very small even with native-size buffers.

Restart land and its clients after upgrading to expose the new protocols. If Firefox still uses the fallback, check `widget.wayland.fractional-scale.enabled` in `about:config`. Land does not modify Firefox preferences automatically.

To repeat the installed Firefox test at 60% in an isolated profile with fractional scaling explicitly enabled (this does not test the browser's default preference): `BUNINU_TEST_BROWSERS=1 BUNINU_TEST_FRACTIONAL_SCALE=1 bun test tests/browser-clients.test.js -t firefox`.

PNG: SHM BGRA → CanvasKit software compositing → CanvasKit PNG → CDP base64 → Casty decoding. Using CanvasKit's PNG encoder directly avoids intermediate RGBA/BMP conversion.

JPEG/WebP: SHM BGRA → CanvasKit software compositing → RGBA readback → BMP wrapping → Bun.Image decoding/encoding → CDP base64 → Casty decoding. BMP wrapping adds a full-frame copy, and Bun.Image then parses the BMP. This cost comes from reusing the browser's encoding utilities; a future encoding path should accept raw pixels directly. The existing CanvasKit WASM's JPEG encoder does not produce output, so it cannot directly replace this path. Casty also receives low-resolution change notifications before requesting full screenshots, adding encoding work.

## Renderer worker

CanvasKit composition and screenshot encoding run in a worker by default, keeping the Wayland socket thread responsive. Use `bun index.js -- --no-render-worker` or set `BUNINU_RENDER_WORKER=0` to render on the main thread instead. The earlier experimental environment variable remains supported, with `BUNINU_RENDER_WORKER` taking precedence.

If the worker cannot start within 10 seconds, exits unexpectedly, raises an uncaught error, or does not answer an active capture within 5 seconds, Land terminates it and falls back to the main-thread renderer with one diagnostic message. The failed capture is retried there. Invalid screenshot options remain ordinary request errors. The worker path allows at most eight queued/in-flight captures; shutdown rejects outstanding requests and terminates the worker.

## Verification

```sh
bun test
```

Tests cover protocol XML opcodes, FD arguments, fragmented packets, exclusive socket locking, malformed-client isolation, real `weston-simple-shm` animation, and CDP PNG/JPEG output. Tests requiring a Weston client are skipped if it is not installed. Casty integration tests exercise its actual launch/setup/screencast code when the test prerequisites are available; otherwise they are skipped. Dependencies are not installed automatically. Screenshot paths are printed in the test output. Casty tests cover receiving images, but do not automatically verify Kitty graphics display in a terminal.


If Chromium/Firefox are already installed, opt into real browser tests with isolated profiles, page text input, and button clicks (no automatic dependency installation):

```sh
BUNINU_TEST_BROWSERS=1 bun test tests/browser-clients.test.js
```

In the tested proot environment, also set `BUNINU_TEST_CHROMIUM_NO_SANDBOX=1`; this disables sandboxing only for the test Chromium process. Regular `bun test` skips these two browser tests but verifies subsurface synchronization, buffer snapshots, stacking, and mode changes.

## Direct Freedreno/KGSL experiment

The installed custom aarch64 Mesa build can render OpenGL directly through Freedreno on Adreno 830. Runtime observation of Termux X11 showed DRI3 DMA-BUF submission; no Termux X11 source was read or copied. Inspection of the installed Mesa EGL binary found that a successful Wayland roundtrip skipped its existing KGSL device-open branch. An isolated, build-specific branch change enabled direct Freedreno rendering and LINEAR DMA-BUF submission to Land, with changing screenshots verified.

Start a new Land instance with experimental linear DMA-BUF import enabled:

```sh
bun index.js -- --linear-dmabuf --poll-interval=1
```

`--linear-dmabuf` advertises v3 with explicit LINEAR ARGB8888/XRGB8888 only. Its importer supports CPU-mappable, single-plane buffers through libc mmap and DMA-BUF read synchronization; unsupported layouts fail import. Default launches do not advertise this protocol. `--poll-interval=1` reduces socket polling latency at increased CPU cost; the default remains 4 ms. `--poll-interval=-1` enables busy polling with `setImmediate`, yielding to the event loop between polls while continuously consuming CPU.

Then run this **inside Debian/proot**, using the actual socket printed by Land:

```sh
WAYLAND_DISPLAY=wayland-buninu bun tests/kgsl-wayland.js
# Or a ten-second measurement:
WAYLAND_DISPLAY=wayland-buninu bun tests/kgsl-wayland.js -b build:duration=10
```

The script uses an existing AArch64-capable `objdump` to locate a unique Wayland roundtrip branch leading to `loader_open_device("/dev/kgsl-3d0")`, verifies the instructions against ELF bytes, and changes one instruction in a private temporary copy. It does not require a fixed file hash or offset. Run `bun tests/kgsl-wayland.js --check-only` to check compatibility without launching a client; set `KGSL_EGL_LIBRARY` to select another EGL library and `OBJDUMP` to select the disassembler. It does not replace system Mesa or load EGL into Land. It selects `kgsl`, clears forced Gallium/software-presentation settings, and defaults `vblank_mode` to 0. This is a diagnostic workaround for matching custom AArch64 Mesa builds, not a general or production driver fix. Missing symbols, different control flow, ambiguous matches, or missing KGSL support are rejected. The expected renderer is `freedreno` / `Adreno (TM) 830`.

A ten-second 800×600 build scene measured 465 client FPS with native Land and 1 ms polling. A temporary busy-polling experiment reached 1125 FPS; Termux X11 with `vblank_mode=0` reached 1992 FPS. Rates vary (a later short busy-poll run measured 588 FPS). Busy polling can now be selected with `--poll-interval=-1`; it remains opt-in and continuously consumes CPU. These measurements used periodic screenshot checks, not an active Casty stream; they do not establish terminal display FPS. Land still copies the imported pixels and composites on the CPU.

## Licensing

The project's original code is MIT-licensed; see `LICENSE`. Sources and licenses for the reused browser code, CanvasKit WASM and its embedded components, and Wayland XML are documented in `THIRD_PARTY_NOTICES.md`, `LICENSES/`, and `SOURCES.md`. The project's MIT declaration does not replace third-party licenses.


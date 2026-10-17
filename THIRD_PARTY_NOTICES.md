# Third-party notices

Buninu Land's original code is distributed under the MIT license in `LICENSE`.
The following notices apply to the respective bundled components.

## Buninu Browser

Source: https://github.com/jjtseng93/buninu-browser
Copyright (c) 2026 Dr. John (醫者小智). MIT; see `LICENSES/buninu-browser.txt`.

`vendor/buninu-browser/cdp-server.js`, `lib/user-agent.js`, and `lib/frame.js` are unchanged copies. `lib/cdp-server.js` adds two optional raw input hooks; see `patches/cdp-input.patch`.
`index.js` is adapted from its launcher: package/engine names and help text are
changed for Wayland, and Chinese README aliases are added; frontend dispatch, argument forwarding, the npx → bunx →
bun x selection, child-process handling, and reserved native frontend commands
are retained. Source revision and exact copied-file hashes are recorded in
`SOURCES.md` and `vendor-manifest.json`.

## CanvasKit / Skia and embedded libraries

`vendor/canvaskit/canvaskit.js` and `canvaskit.wasm` are unchanged copies from
Buninu Browser. The WASM matches the official `canvaskit-wasm` 0.41.1 default
binary byte-for-byte. The JS loader contains two inherited `wasmBinary` fixes;
see `patches/canvaskit/README.md` and the recorded patch.
Source: https://skia.googlesource.com/skia
Skia revision: `3c68f3ffd7c9bc781494cdb85e718ff1e6f49d84`.
BSD-3-Clause; see `vendor/canvaskit/LICENSE` and `LICENSES/BSD-3-Clause-Skia.txt`.

Embedded-component notices are retained from the browser distribution of the
same binary. Identification follows that distribution's binary inspection and
upstream build configuration; exact revisions of all embedded libraries have
not been independently reconstructed.

| Component | License text | Upstream |
| --- | --- | --- |
| HarfBuzz | `LICENSES/harfbuzz.txt` | https://github.com/harfbuzz/harfbuzz |
| ICU (binary reports ICU 74) | `LICENSES/icu.txt` | https://github.com/unicode-org/icu |
| FreeType | `LICENSES/freetype.txt` | https://gitlab.freedesktop.org/freetype/freetype |
| libpng | `LICENSES/libpng.txt` | https://github.com/pnggroup/libpng |
| libjpeg-turbo / IJG | `LICENSES/libjpeg-turbo.txt`, `LICENSES/libjpeg-ijg.txt` | https://github.com/libjpeg-turbo/libjpeg-turbo |
| libwebp | `LICENSES/libwebp.txt` | https://github.com/webmproject/libwebp |
| Wuffs | `LICENSES/wuffs.txt` | https://github.com/google/wuffs |
| WOFF2 | `LICENSES/woff2.txt` | https://github.com/google/woff2 |
| Brotli | `LICENSES/brotli.txt` | https://github.com/google/brotli |
| zlib | `LICENSES/zlib.txt` | https://github.com/madler/zlib |
| Emscripten runtime | `LICENSES/emscripten.txt` | https://github.com/emscripten-core/emscripten |

### Binary-distribution acknowledgements

This software is based in part on the work of the FreeType Team.
See https://freetype.org and `LICENSES/freetype.txt`.

This software is based in part on the work of the Independent JPEG Group.
See `LICENSES/libjpeg-ijg.txt` and `LICENSES/libjpeg-turbo.txt`.

Skia includes the skcms color-management code, copyright 2018 Google Inc.,
under the same BSD license (`LICENSES/BSD-3-Clause-Skia.txt`). Its ETC1 support
is copyright 2009 Google Inc., Apache-2.0 (`LICENSES/Apache-2.0.txt`). The ETC1
notice is retained for Skia's texture support even though this compositor
uses only CPU rendering.

Emscripten's compiled runtime also includes musl, LLVM libc++, libc++abi, and
compiler-rt code. Their notices are retained in `LICENSES/musl.txt`,
`LICENSES/libcxx.txt`, `LICENSES/libcxxabi.txt`, and `LICENSES/compiler-rt.txt`.
These texts are from Emscripten 4.0.7, the version named by the corresponding
Skia checkout's `infra/wasm-common/docker/emsdk-base/Dockerfile`. The npm
artifact does not supply a full build manifest, so that build-tool version
is a source-configuration reference, not independently verified binary metadata.

The FreeType, HarfBuzz, ICU, libpng, libwebp, Brotli, zlib and libjpeg-turbo
license texts were checked against the revisions in that Skia checkout's
`DEPS`. In particular, the zlib and libjpeg-turbo texts were replaced with
those revision-specific copies rather than newer upstream versions. The
other inherited license texts remain as supplied by the browser distribution.
No standalone fonts are shipped. The upstream NotoMono font byte sequence is
not present in the distributed default WASM; the optional embedded-font
build configuration is not assumed to be enabled in this artifact.

## Wayland protocol descriptions

`protocols/wayland.xml` and `protocols/xdg-shell.xml` are unmodified system
protocol descriptions; their copyright and MIT-style permission notices are
retained inside each XML file. Source locations are recorded in `SOURCES.md`.

Hyprland was consulted for protocol behavior; no Hyprland C++ source or binary
is distributed. No Hyprland license is applied to this independent JS code.

## External runtime and frontend

Bun and libc are provided by the host, not bundled. `@drxiaozhi/casty` is launched
as a separate package using npx, bunx, or bun x; its source is not bundled.
Those launchers may download Casty if it is not already installed or cached.
Bun.Image is a Bun runtime API, not a separately distributed native addon.

## Hyprland window management and input

The JS Dwindle-style layout and seat/focus implementation reference Hyprland (Copyright 2022–2026 vaxerski and contributors), BSD-3-Clause. See `LICENSES/hyprland.txt` and `SOURCES.md` for the source revision and paths. No Hyprland native library is linked. This implements a subset, not full Hyprland compatibility.

The vendored `protocols/viewporter.xml` and `protocols/fractional-scale-v1.xml` retain their upstream copyright and MIT-style permission notices in full. Sources and hashes are recorded in `SOURCES.md` and `vendor-manifest.json`.

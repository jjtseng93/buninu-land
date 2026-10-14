# Third-party notices

Buninu Land's original code is distributed under the MIT license in `LICENSE`.
The following notices apply to the respective bundled components.

## Buninu Browser

Source: https://github.com/jjtseng93/buninu-browser
Copyright (c) 2026 Dr. John (醫者小智). MIT; see `LICENSES/buninu-browser.txt`.

`lib/cdp-server.js`, `lib/user-agent.js`, and `lib/frame.js` are unchanged copies.
`index.js` is adapted from its launcher: package/engine names and help text are
changed for Wayland; frontend dispatch, argument forwarding, the npx → bunx →
bun x selection, child-process handling, and reserved native frontend commands
are retained. Source revision and exact copied-file hashes are recorded in
`SOURCES.md` and `vendor-manifest.json`.

## CanvasKit / Skia and embedded libraries

`vendor/canvaskit/canvaskit.js` and `canvaskit.wasm` are unchanged artifacts
inherited from Buninu Browser's official `canvaskit-wasm` 0.41.1 distribution.
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

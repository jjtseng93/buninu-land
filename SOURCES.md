# Sources and reuse

No packages were installed for this implementation.

- `lib/cdp-server.js`, `lib/user-agent.js`, `lib/frame.js`: byte-for-byte copies of `../buninu-browser/lib/cdp-server.js`, `lib/user-agent.js`, and `lib/paint/frame.js`. Source checkout HEAD: `a2b9c2ca546b97dc92c5afa11bdab34513d55b11`. Copies reflect the actual workspace files; SHA-256 values are recorded in `vendor-manifest.json`. MIT notice retained in `LICENSE`.
- `vendor/canvaskit/canvaskit.js` and `canvaskit.wasm`: byte-for-byte copies from `../buninu-browser/usr/lib/canvaskit/`. License retained alongside them.
- `protocols/wayland.xml`: copied unchanged from `/usr/share/wayland/wayland.xml`.
- `protocols/xdg-shell.xml`: copied unchanged from `/usr/share/wayland-protocols/stable/xdg-shell/xdg-shell.xml`.
- Protocol XML files contain their own copyright and permission notices.

The requested neighboring repository is named `../Hyprland`, rather than `../Hyperland`. Its checkout HEAD at implementation time was `e2ad066c9ffd45ddfbe4dc76d2de16b382fbe3eb`. Its `CMakeLists.txt` likewise consumes the system wayland.xml and stable/xdg-shell XML. Its `src/protocols/core/Shm.cpp`, core compositor structure, and `src/protocols/XDGShell.cpp` were consulted for pool lifetime, validation, and configure ordering. No C++ was built or linked. The first milestone implements a subset of these protocols in JS; it does not claim full Hyprland behavior.

`index.js` is adapted from the same Buninu Browser checkout's package launcher.
Product/engine names and user-facing Wayland help text differ; Chinese README aliases are added. Embedded
CanvasKit dependency license texts were copied from that browser's `LICENSES/`;
see `THIRD_PARTY_NOTICES.md` for the component mapping.


Release audit: the cached official CanvasKit 0.41.1 tarball matches the npm
registry SHA-512 integrity. Its default WASM matches our binary. The inherited
JS loader differs from the official JS; see `patches/canvaskit/` for its exact
diff and original/local hashes. Notices for zlib and libjpeg-turbo now use the
revisions pinned in Skia's DEPS; additional compiled-runtime notices use the
Emscripten 4.0.7 source tree referenced by Skia's wasm build configuration.
See `THIRD_PARTY_NOTICES.md` for verification limits.

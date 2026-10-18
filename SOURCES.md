# Sources and reuse

No packages were installed for this implementation.

- `vendor/buninu-browser/cdp-server.js`, `lib/user-agent.js`, `lib/frame.js`: byte-for-byte copies of `../buninu-browser/lib/cdp-server.js`, `lib/user-agent.js`, and `lib/paint/frame.js`. Source checkout HEAD: `a2b9c2ca546b97dc92c5afa11bdab34513d55b11`. Copies reflect the actual workspace files; SHA-256 values are recorded in `vendor-manifest.json`. MIT notice retained in `LICENSE`.
- `vendor/canvaskit/canvaskit.js` and `canvaskit.wasm`: byte-for-byte copies from `../buninu-browser/usr/lib/canvaskit/`. License retained alongside them.
- `protocols/wayland.xml`: copied unchanged from `/usr/share/wayland/wayland.xml`.
- `protocols/xdg-shell.xml`: copied unchanged from `/usr/share/wayland-protocols/stable/xdg-shell/xdg-shell.xml`.
- `protocols/viewporter.xml`: copied unchanged from `/usr/share/wayland-protocols/stable/viewporter/viewporter.xml`.
- `protocols/fractional-scale-v1.xml`: copied unchanged from `/usr/share/wayland-protocols/staging/fractional-scale/fractional-scale-v1.xml`.
- `protocols/linux-dmabuf-v1.xml`: copied unchanged from `/usr/share/wayland-protocols/unstable/linux-dmabuf/linux-dmabuf-unstable-v1.xml` (system wayland-protocols 1.44). The experimental implementation exposes version 3 and CPU-readable, single-plane, explicitly linear ARGB8888/XRGB8888 only. Params lifetime and import failure behavior were checked against `../Hyprland/src/protocols/LinuxDMABUF.cpp`; no native code is copied or linked.
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

`lib/cdp-server.js` adds two optional raw input hooks to the preserved browser original. The exact diff is in `patches/cdp-input.patch`; mouse/key press and release must reach Wayland independently.

Window management and seat focus code consults Hyprland at the revision above: `src/layout/algorithm/tiled/dwindle/DwindleAlgorithm.cpp`, `src/managers/SeatManager.cpp`, and `src/desktop/state/FocusState.cpp`. The JS implementation is a limited adaptation; the upstream BSD-3-Clause notice is retained in `LICENSES/hyprland.txt`.

Browser compatibility work consulted GTK 3's [`gdk/wayland/gdkdisplay-wayland.c`](https://github.com/GNOME/gtk/blob/gtk-3-24/gdk/wayland/gdkdisplay-wayland.c) for the data-device-manager/seat initialization dependency and Firefox's [`widget/gtk/nsWaylandDisplay.cpp`](https://github.com/mozilla/gecko-dev/blob/master/widget/gtk/nsWaylandDisplay.cpp) for required Wayland globals. No GTK or Firefox source code was copied or linked. Subsurface semantics follow the existing vendored `protocols/wayland.xml`; the implementation is JavaScript.

Pointer scroll framing was checked against GTK 3's [`gdk/wayland/gdkdevice-wayland.c`](https://github.com/GNOME/gtk/blob/gtk-3-24/gdk/wayland/gdkdevice-wayland.c), particularly `gdk_wayland_seat_flush_frame_event`: motion/enter events and axis events must reach separate frames for this client path. No GTK source code was copied.

Fractional scaling follows the design in the neighboring Hyprland checkout: `src/protocols/FractionalScale.cpp`, `src/desktop/view/WLSurface.cpp`, and `src/render/ElementRenderer.cpp`. The JS implementation uses upstream fractional-scale and viewporter XML, separates logical surface geometry from buffer dimensions, and avoids resampling matching physical-size buffers. No native code is linked.

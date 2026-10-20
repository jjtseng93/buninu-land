# Browser GPU experiment / 瀏覽器 GPU 實驗

Run from Debian/proot using the existing custom AArch64 KGSL Mesa and PCI stub.
No dependencies are installed by the launcher. The private EGL patch uses the
same control-flow checks as `kgsl-wayland.js`; system Mesa stays unchanged.

在 Termux 原生端啟動 Land：

```sh
bun index.js -- --linear-dmabuf --lazy-dmabuf --poll-interval=1
```

在共享 `/tmp` 的 Debian/proot 中，從本專案目錄執行其中一個瀏覽器。
`WAYLAND_DISPLAY` 請換成 Land 實際印出的 socket 名稱；一次跑一個方便比較。

```sh
env XDG_RUNTIME_DIR=/tmp WAYLAND_DISPLAY=wayland-buninu bun tests/browser-gpu-wayland.js chromium
env XDG_RUNTIME_DIR=/tmp WAYLAND_DISPLAY=wayland-buninu bun tests/browser-gpu-wayland.js firefox-esr
```

The launcher opens Aquarium in a fresh temporary profile, whose location is printed.
It disables browser sandboxing for the proot experiment; it is not a normal browsing
configuration. It does not enable a debugging port unless passed explicitly, e.g.
`--remote-debugging-port=19430` for Chromium or `--remote-debugging-port=19432`
for Firefox. Close the browser to finish; profiles remain in the temporary directory.

腳本使用獨立暫存 profile，並為此 proot 實驗停用瀏覽器 sandbox；不是日常瀏覽設定。
它不會修改使用者原本的 profile。關閉瀏覽器即結束，暫存 profile 保留。

## Findings / 實測結果

2026-10-20, Adreno 830, native Land with render worker, 1024×768 output;
Aquarium default 500 fish, 1024×1024 canvas. Separate 15-second runs sampled
Aquarium's displayed FPS once per second after loading:

| Browser | WebGL renderer | FPS mean (range) |
| --- | --- | --- |
| Chromium 155.0.8059.79 | ANGLE / Adreno 830 / OpenGL ES | 56.0 (52–58) |
| Firefox ESR 153.5.0 | Adreno 830 / GLES | 58.9 (56–62) |

Land screenshots showed the rendered fish in both browsers. These are page FPS,
not measured Casty/terminal display FPS. Browser presentation and Land composition
remain software; Chromium reports `webgl: enabled_readback` and
`gpu_compositing: disabled_software`. GPU rendering still incurs readback and SHM
copying on this route. No compositor production code was changed for this test.

兩個瀏覽器都確認 GPU WebGL 且 Land 截圖有魚群。這是網頁 FPS，並非 Casty
或終端實際顯示 FPS；瀏覽器呈現與 Land 合成仍走軟體，仍有 GPU readback、SHM
複製成本。本次不需要改 Land 正式程式。

- Reuse `/usr/local/lib/chromium-pci-stub/libpci.so.3`, as the local
  `/usr/local/bin/chromium-headless-shell` wrapper already does. Chromium's real
  libpci exits when Android denies `/proc/bus/pci/devices`; omitting the stub also
  made a fresh Firefox profile fall back to llvmpipe. `CHROMIUM_PCI_STUB` overrides
  the directory for both browsers.
- Chromium uses `--use-gl=angle --use-angle=gles`, not Zink or ANGLE Vulkan.
- Firefox uses `EGL_PLATFORM=wayland`, forced WebGL, GLES preference and software
  WebRender. This is a tested combination, not a claim that every flag is necessary.
  Its normal renderer sanitization reports `Adreno (TM) 650, or similar`; a separate
  diagnostic profile with `webgl.sanitize-unmasked-renderer=false` confirmed
  `Adreno (TM) 830`. The launcher leaves sanitization enabled.
- Apt-installed Firefox 158.0 build2 failed in this proot with `Shared memory
  PlatformHandle is not safe to map` and content-process crashes. Use the tested
  `firefox-esr` explicitly; the plain `firefox` wrapper may select 158 instead.
- Native Termux Chromium 138 rejected `--ozone-platform=wayland`; native Firefox
  152 still requested X11 DISPLAY with Wayland requested. Those builds were not
  pursued further. Vulkan driver availability alone does not supply a missing
  browser Wayland backend.

## Inspection / 檢查方式

In Aquarium's browser console, inspect its existing context without calling
`canvas.getContext()` with a different type (that can trigger its error overlay):

```js
gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)
document.getElementById('fps').textContent
```

Use Land's screenshot output to verify visible pixels as well as the renderer
string. A renderer name or high FPS alone is not proof that frames reach Land.

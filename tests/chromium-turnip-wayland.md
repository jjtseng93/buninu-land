# Chromium ANGLE Vulkan / Turnip experiment

This is separate from `browser-gpu-wayland.js` (GLES). It uses Chromium's ANGLE
Vulkan backend with a selected Turnip ICD, the existing PCI stub, and a fresh
temporary browser profile. No Mesa EGL binary patch, Zink, installations, system
library replacements, or Land production changes are needed.

這是獨立於 GLES 的實驗：Chromium → ANGLE Vulkan → Turnip → Adreno 830。
沿用現有 PCI stub，但不需要之前的 EGL 修補，也不經過 Zink。

## Run / 執行

Start Land normally in native Termux. For the recorded measurements, Land used
`--linear-dmabuf --lazy-dmabuf --poll-interval=1` and its default render worker.
The browser's visible presentation in these runs used SHM, not direct Vulkan
DMA-BUF presentation. Use the actual Land socket name below.

In Debian/proot, from this repository, using the existing independently built
official Mesa 26.2.5 installation:

```sh
env XDG_RUNTIME_DIR=/tmp WAYLAND_DISPLAY=wayland-buninu \
  VK_DRIVER_FILES=/home/johnny/mesa-upstream-test/install/share/vulkan/icd.d/freedreno_icd.aarch64.json \
  bun tests/chromium-turnip-wayland.js
```

換成自己的 Land socket 和 Turnip ICD JSON 路徑。省略 `VK_DRIVER_FILES` 時，腳本
使用目前這台機器的系統 `/usr/share/vulkan/icd.d/freedreno_icd.aarch64.json`。
此路徑需包含可在 KGSL 上運作的 Turnip，不能只看檔名就假設支援。

`CHROMIUM_PCI_STUB` defaults to `/usr/local/lib/chromium-pci-stub` and must contain
the already installed `libpci.so.3` stub used by `/usr/local/bin/chromium-headless-shell`.
The launcher disables browser sandboxing for this proot experiment, prints its
temporary profile directory, and leaves that profile after the browser exits.
It does not enable a debugging port unless one is passed explicitly.

## Verification / 驗證

With `--remote-debugging-port=19430`, CDP `SystemInfo.getInfo` reported:

```text
glImplementationParts: (gl=egl-angle,angle=vulkan)
glRenderer: ANGLE (Qualcomm, Vulkan 1.4.354 (Adreno (TM) 830 (0x44050001)), turnip Mesa driver-26.2.5)
webgl: enabled_readback
gpu_compositing: disabled_software
```

Land screenshots showed the Aquarium fish with each tested configuration.
`vulkan: disabled_off` in Chromium's feature table does not contradict ANGLE's
Vulkan renderer: that entry describes Chromium's separate Vulkan feature, not
the selected ANGLE WebGL backend. Enabling `--enable-features=Vulkan,VulkanFromANGLE`
changed it to `enabled_on`, but did not enable GPU composition in this test.

Land 截圖確認魚群正常顯示。WebGL 確實用 Turnip Vulkan，但瀏覽器仍回讀像素、
軟體合成後傳給 Land。這不是全程 Vulkan 合成，也不是零複製；系統驅動實驗的
日誌明確出現 `GPU stall due to ReadPixels`。

Aquarium measurements: Chromium 155.0.8059.79, 500 fish, 1024×1024 canvas,
1024×768 Land output. Each run sampled the page's displayed FPS 15 times at
one-second intervals, with only one browser running. Raw results are in
`chromium-turnip-wayland-results.json`. These are page FPS, not Casty/terminal
throughput, and sequential short runs are not a controlled thermal benchmark.

| Turnip / configuration | Mean page FPS | Sample range |
| --- | ---: | ---: |
| System custom Mesa 26.0.0-devel, ANGLE Vulkan | 39.0 | 36–48 |
| Same driver, plus Vulkan / VulkanFromANGLE | 40.3 | 20–61 |
| Official Mesa 26.2.5, ANGLE Vulkan | 59.4 | 56–62 |

上述均確認使用 Turnip，而不是 SwiftShader 或 llvmpipe。新版這組啟動後留在
實驗 socket `wayland-browser-gpu`；日常重跑應改用自己 Land 的 socket。

## Firefox / Firefox 的範圍

No direct Firefox ANGLE-Vulkan WebGL launch was established. Mozilla's
[ANGLE build configuration](https://github.com/mozilla-firefox/firefox/blob/main/third_party/angle/moz.build)
includes the full ANGLE rendering libraries for Windows and macOS, rather than
a Linux Vulkan renderer. Therefore Chromium's `--use-angle=vulkan` approach does
not directly transfer to the installed Linux Firefox. This does not imply that
Firefox WebGPU or a separate GL-to-Vulkan implementation cannot use Vulkan.

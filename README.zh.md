# Buninu Land

[English](README.md) | 繁體中文

A Wayland compositor in JavaScript and WebAssembly for Bun

> **警告：** 本專案仍處於非常早期的開發階段，功能尚不完整，行為與 API 可能大幅變動，目前不適合日常使用。

用 Bun 直接執行的 Wayland compositor。第一版支援 headless 軟體合成，已用系統的 `weston-simple-shm` 驗證動畫，以及 Casty 的啟動、CDP 設定和畫面接收流程。沒有 build step、npm runtime dependencies 或 compositor GPU 繪製路徑。

## 執行

需要 Linux 或 Android 64-bit（aarch64 或 x86_64），以及提供 `Bun.XML`、`Bun.Image`、`bun:ffi` 的 Bun。`process.platform === 'android'` 時載入 Bionic `libc.so`／`__errno`；Linux 優先載入 `libc.so.6`／`__errno_location`。已在 Linux aarch64、Bun 1.4.3-canary.1 實測；作者也已完成 Android 原生環境驗證。

直接執行專案入口，就會自動啟動 Casty，再由 Casty 帶起 compositor：

```sh
bun index.js
```

套件名稱為 `buninu-land`，全域指令也叫 `buninu-land`。發布至 npm 後可使用：

```sh
npm install -g buninu-land
buninu-land
# 或不全域安裝：
npx buninu-land
bunx buninu-land
bun x buninu-land
```

需先有 Bun。啟動器沿用 browser 的流程：PATH 同時有 npx 與 bun 時使用 npx，否則使用 bunx，再否則使用 bun x。Casty 套件為 [`@drxiaozhi/casty`](https://www.npmjs.com/package/@drxiaozhi/casty)（[GitHub 原始碼](https://github.com/jjtseng93/casty)）；尚未安裝／快取時，套件執行器可能下載它。npx 保留原有安裝詢問，不加 `--yes`。

發布後第一次執行 `npx buninu-land`，npx 會取得 Buninu Land，接著 launcher
會在需要時自動下載終端前端
[`@drxiaozhi/casty`](https://www.npmjs.com/package/@drxiaozhi/casty)
（[GitHub 原始碼](https://github.com/jjtseng93/casty)）。
`bun index.js` 使用同一套套件啟動流程；headless 模式不會下載 Casty。

`--casty` 為預設前端；`--headless` 只執行 compositor。`--win32`、`--gtk`、`--appkit`、`--qt` 保留 browser 的原生 UI 占位命令，目前會說明尚未實作並以狀態碼 2 離開。第一個參數選擇前端，其餘參數原樣傳遞。

```sh
bun index.js --help       # 或 -h
bun index.js --version    # 或 -V
bun index.js --readme
bun index.js --readme-zh  # 或 --docs
bun index.js --headless --help
bun index.js --casty --help
```

Land launcher 會自動加上 `--no-shortcuts`，將頁面上的全部按鍵傳給 Wayland client。點網址列左側 **@** 開啟空白 `cmd>`，輸入 `q` 再按 Enter 退出 casty。點網址仍可編輯，編輯時保留快捷鍵；需搭配新版 casty。

也可自行從 Casty 啟動：

```sh
export CASTY_BROWSER="$PWD/compositor.js"
bunx @drxiaozhi/casty --no-shortcuts about:blank
```

Socket 目錄依序採用明確設定的 `$XDG_RUNTIME_DIR`、`$TMPDIR`、系統暫存目錄。Socket 直接放在該目錄，不另加子目錄；自動選取第一個未被鎖定的名稱：`wayland-buninu`、`wayland-buninu1`、`wayland-buninu2`，依此類推。例如另一個終端：

```sh
WAYLAND_DISPLAY="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/wayland-buninu" weston-simple-shm
```

未指定 `--socket` 時，用核心的 `flock` 排他鎖判斷是否仍在使用，不以 socket 檔案存在與否判斷。程序退出或崩潰後會釋放鎖，下次啟動可回收殘留 socket 和前面的空缺編號。明確指定 `--socket=NAME` 時不自動改名；被占用會報錯。啟動輸出的 `WAYLAND_DISPLAY` 是本次實際名稱／路徑，客戶端應使用它。多開 headless 時可加 `--remote-debugging-port=0`，讓 CDP port 也自動分配。

啟動 Konsole 時，請加上 `QT_QPA_PLATFORM=wayland` 明確選擇 Qt 的 Wayland 後端，避免選到錯誤的平台後端。在另一個終端使用與 compositor 相同的 socket 目錄：

```sh
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
export WAYLAND_DISPLAY=wayland-buninu
QT_QPA_PLATFORM=wayland konsole
```

Konsole 的啟動、畫面顯示，以及鍵盤與滑鼠輸入已驗證。

### Chromium 與 Firefox

在另一個終端，使用與 compositor 相同的 socket 目錄與名稱。作者實測 Chromium 只需設定 `XDG_RUNTIME_DIR`、`WAYLAND_DISPLAY`，再加上 `--ozone-platform=wayland --no-sandbox` 即可啟動，不需要 `--disable-gpu`：

```sh
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}"
export WAYLAND_DISPLAY=wayland-buninu
chromium --ozone-platform=wayland --no-sandbox
firefox
```

Firefox ESR 140.12.0 也已實測只需上述 `XDG_RUNTIME_DIR` 和 `WAYLAND_DISPLAY`，直接執行 `firefox` 即可自動使用 Wayland；不需要設定 `MOZ_ENABLE_WAYLAND` 或 `GDK_BACKEND`。此測試未設定 `DISPLAY` 或 `XDG_SESSION_TYPE`，網頁顯示、文字輸入與滑鼠點擊均通過。

已用系統安裝的 Chromium 153.0.8010.52 與 Firefox ESR 140.12.0 驗證真實視窗、網頁軟體渲染、文字輸入和滑鼠點擊。測試使用獨立 profile，沒有下載或安裝瀏覽器；未驗證 WebGL、影片或所有網站。若瀏覽器已在其他桌面執行，請先關閉，避免命令被轉交既有程序。

上述 Chromium 指令中的 `--no-sandbox` 會停用瀏覽器沙箱，只適合隔離環境中的受信任內容測試，不建議用於一般瀏覽。Firefox 不需停用 sandbox。Android 原生瀏覽器執行檔尚未在本次測試中驗證。

Firefox 使用的 subsurface 已接入合成與滑鼠座標處理。`wl_data_device_manager` 目前僅提供 GTK 初始化所需的介面及空選取狀態；剪貼簿與拖放仍未實作。

Casty 會傳入 `--remote-debugging-port=0`，由系統選擇可用 port；Casty 從 compositor 輸出的 DevTools URL 取得實際 port。手動 headless 啟動預設使用 9222。

Casty 傳入的 Chromium 相容 flags（例如 `--no-sandbox`、`--user-data-dir`、`--disable-*`）目前忽略；`--remote-debugging-port` 與 `--window-size` 會實際生效。

直接 headless 執行：

```sh
bun compositor.js --headless --remote-debugging-port=9222
```

手動 headless 與 Casty 自動啟動可並存，預設會分配不同 socket。Casty 的 URL 不會開網頁；顯示的是 Wayland 桌面。

`bun compositor.js --help` 列出選項。預設從 `wayland-buninu` 開始尋找可用 socket，預設畫面 800×600。`--socket=NAME` 可選擇其他 socket；`--remote-debugging-port=0` 自動選 port。`BUNINU_LOG=1` 將 Wayland requests 寫到 stderr。

Land 導航後會在網址列顯示本次實際的 Wayland socket 路徑，不受傳入網址影響，也不會開啟網頁。

## 更新與清除快取

可用 `npx buninu-land@latest` 明確要求最新發布版本。Casty 由選定的套件執行器
另外解析；只清除 Buninu Land 快取，不會一併清除 Casty。Casty 離開時會印出版本。

要重新取得快取中的套件，可使用以下指令。npm 11 或更新版本先列出項目，再刪除
`buninu-land` 與 `@drxiaozhi/casty` 對應的 key；請將佔位文字換成實際列出的 key：

```sh
npm cache npx ls
npm cache npx rm <buninu-land-key> <casty-key>

# 或清除所有 npx 項目，包含其他工具：
npm cache npx rm --force

# 若 launcher 使用 bunx 或 bun x，清除 Bun 的套件快取：
bun pm cache rm
```

舊版 npm 可先執行 `npm config get cache`，再刪除該目錄內的 `_npx` 子目錄。
Linux／Android 常見路徑是 `~/.npm/_npx`，但自訂 npm cache 設定可能改變位置。
清除整個 npx 或 Bun 快取也會影響其他已快取的套件。這些操作不會移除全域安裝的
套件；若使用全域安裝，更新方式是 `npm install -g buninu-land@latest`。

參考：[npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache/)、
[Bun 套件快取指令](https://bun.sh/docs/pm/cli/pm)。

## 結構

- `index.js`：沿用 browser 的套件 launcher，預設啟動 Casty，設定 `CASTY_BROWSER` 指向 compositor。
- `compositor.js`：headless controller、CDP context adapter、生命週期與 CLI。
- `lib/cdp-server.js`：沿用 browser CDP server，增加兩個可選的原始輸入 hook，以及可選的導航網址轉換 hook；未修改原版保留於 `vendor/buninu-browser/cdp-server.js`，差異見 `patches/cdp-input.patch`。`user-agent.js` 也原樣沿用，因此 CDP 保留 Buninu 的相容識別。
- `lib/protocol.js`：使用 `Bun.XML.parse()` 在執行時讀標準 XML，依原始順序處理 opcode／argument。
- `lib/transport.js`：僅以 Bun FFI 載入 libc；Unix socket、`recvmsg`／`SCM_RIGHTS`、非阻塞傳輸、socket lock、FD 清理。
- `lib/compositor.js`：每個 client 的 object table、SHM pool／buffer 生命週期、surface commit、xdg configure／ack、frame callback。
- `lib/renderer.js`：沿用 browser 的 CanvasKit WASM，以 CPU 合成；`lib/frame.js` 原樣沿用 browser 的 `Bun.Image` 編碼工具。

SHM 在 commit 時使用 libc `pread` 複製到 compositor 持有的像素，然後釋放 client buffer。這讓 client 可以安全重用 buffer；也避免 client 截短 mmap backing file 導致 compositor SIGBUS。Pool resource 被銷毀後，只要 buffer 還存在，FD 就仍然保留。

## 第一版範圍

公布 `wl_compositor` v4、`wl_shm` v1、`xdg_wm_base` v1、`wl_output` v2、`wl_seat` v5（滑鼠與鍵盤）、`wl_subcompositor` v1、`wl_data_device_manager` v1。SHM 支援 ARGB8888 與 XRGB8888。第一個一般視窗填滿工作區，保留 8 像素外側間距；新增視窗會分割平鋪區域。約 60 Hz 排程，每次提交仍完整複製 buffer。

Casty 滑鼠與鍵盤事件已轉送 Wayland，包含 JS 產生的 XKB keymap、焦點、基本 popup 與全螢幕 configure，仍屬早期實作。已支援 subsurface 的同步／非同步提交、位置與堆疊。尚未支援觸控、剪貼簿與拖放、GPU 合成、通用 DMA-BUF 支援、完整 popup 邊界調整，以及全面的協定與角色生命週期驗證。

### 視窗快捷鍵

以下三組對應 [Omarchy v3.3.0](https://github.com/basecamp/omarchy/blob/v3.3.0/default/hypr/bindings/tiling-v2.conf)，直接使用 Super：

| 快捷鍵 | 操作 |
| --- | --- |
| Super+方向鍵 | 切換到目前工作區中該方向的視窗 |
| Super+W | 請求關閉焦點視窗；應用程式仍可能要求確認 |
| Super+F | 切換全螢幕，再按一次恢復布局 |

全螢幕時切換方向焦點，會將全螢幕轉移到選中的視窗；該方向沒有視窗則不動作。目前只啟用這三組快捷鍵；F6–F9 與 W／方向鍵／Tab 測試圖案均已移除。Tab 組合交回應用程式。請在支援 Kitty keyboard 的終端（例如新版 jsgotty 或 bunterm）裡使用新版 casty。Casty 會自動協商並將 Super 以 CDP Meta 傳入，包括按鍵放開事件。Ctrl+Alt 組合現在交回應用程式，不再作為視窗快捷鍵的替代。傳統終端仍能使用，但無法可靠傳遞 Super。修改後須重啟 casty 和 compositor。

協定定義原樣保留，但實作為 JS，並不是 Hyprland C++ 的逐位元複本，也不代表 XML 中每個 request 都已實作。參考來源見 `SOURCES.md`。

## 畫面轉換成本

Renderer 會快取不可變 SHM 快照對應的 CanvasKit image，重用一個完整尺寸及一個預覽繪圖 surface，並在像素、位置、堆疊、游標及 viewport 未變時重用合成結果。預覽可以使用已存在且符合場景的完整影像，但不會為了預覽強制重畫完整尺寸。代價是截圖之間保留繪圖記憶體；過期 image、尺寸變更的 buffer 及關閉時的 renderer 資源會釋放。

Casty zoom 透過 CDP `deviceScaleFactor` 套用：排版與輸入保留邏輯座標，截圖則使用實際像素尺寸。使用縮圖 fallback 的客戶端在 zoom 小於 1 時採用線性取樣，減少縮小內容造成的鋸齒與筆畫遺失。這些修改只在 land，Casty 與 buninu-browser 維持不變。

Land 提供 `wp_fractional_scale_manager_v1` 與 `wp_viewporter`。支援的客戶端可以依指定比例繪製 buffer，同時保留視窗邏輯尺寸及輸入座標。Viewport 裁切／目標尺寸隨 surface commit 套用，也支援同步子視窗；符合實際像素尺寸的 fractional buffer 會對齊像素，避免再次插值。不支援的客戶端仍使用原本的縮圖路徑。

已檢查兩個 Firefox 版本的縮放行為：

- **Firefox 153.5.0 ESR：**執行中的 Casty 60% 工作階段使用 667 × 810 邏輯 viewport，輸出為 400 × 486。Firefox 共享像素 buffer 也包含 400 × 486 像素，其中 99.95% 的 RGB 像素與擷取的 PNG 完全相同，確認此次輸出保留客戶端像素，而非再縮小較大的影像。PNG 中的文字較清楚；未量測終端最後顯示的效果，此次也未重跑整套瀏覽器輸入測試。
- **Firefox 140.12.0 ESR：**測試時預設未啟用 fractional scaling。在 `about:config` 設定 `widget.wayland.fractional-scale.enabled=true` 並重啟後，已於獨立 profile 驗證 60% 下的目標解析度網頁 buffer、文字輸入、點擊與捲動。該次測試的 GTK 視窗裝飾仍走 fallback。

不使用 fractional scaling 的客戶端仍能顯示並按原本邏輯座標接受輸入，但縮小其點陣影像仍可能模糊。同一應用程式內的不同 surface 也可能採用不同路徑。Casty zoom 與 Firefox 自己的網頁 zoom 是分開的；即使 buffer 符合輸出解析度，網頁 zoom 仍可能讓文字很小。

更新後需重啟 land 及客戶端以使用新協定。若 Firefox 仍走 fallback，可在 `about:config` 檢查 `widget.wayland.fractional-scale.enabled`；land 不會自動修改 Firefox 偏好設定。

可用已安裝的 Firefox 重跑 60% 獨立 profile 測試；此測試會明確啟用 fractional scaling，不用來驗證瀏覽器的預設值：`BUNINU_TEST_BROWSERS=1 BUNINU_TEST_FRACTIONAL_SCALE=1 bun test tests/browser-clients.test.js -t firefox`。

PNG：SHM BGRA → CanvasKit 軟體合成 → CanvasKit PNG → CDP base64 → Casty 解碼。直接使用 CanvasKit 的 PNG encoder，避免中間的 RGBA／BMP 轉換。

JPEG／WebP：SHM BGRA → CanvasKit 軟體合成 → RGBA readback → BMP 包裝 → Bun.Image 解碼／編碼 → CDP base64 → Casty 解碼。BMP 包裝會額外複製完整畫面，Bun.Image 再解析 BMP；這是沿用 browser 編碼工具的成本，後續應改為能接收 raw pixels 的編碼路徑。現有 CanvasKit WASM 的 JPEG encoder 無法產生結果，因此不能直接替換這段。Casty 本身也會先取得低解析度變動通知，再要求完整截圖，會有額外編碼工作。

## Renderer worker

CanvasKit 合成與截圖編碼預設在 Worker 中執行，讓 Wayland socket 所在的執行緒保持可回應。使用 `bun index.js -- --no-render-worker` 或設定 `BUNINU_RENDER_WORKER=0`，可改回主執行緒繪製。先前的實驗環境變數仍受支援，但 `BUNINU_RENDER_WORKER` 的設定優先。

若 Worker 在 10 秒內未完成啟動、意外退出、發生未捕捉錯誤，或執行中的截圖請求超過 5 秒未回覆，Land 會終止 Worker，印出一次診斷訊息並回退到主執行緒 renderer，重新嘗試失敗的截圖。無效截圖參數仍視為一般請求錯誤，不會觸發回退。Worker 路徑最多接受八個排隊或執行中的截圖；關閉時會拒絕未完成請求並終止 Worker。

## 驗證

```sh
bun test
```

測試包括協定 XML opcode、FD 參數、分段封包、socket 排他鎖、無效 client 隔離，以及真實 `weston-simple-shm` 動畫和 CDP PNG／JPEG。若沒有已安裝的 weston client，相關測試跳過。Casty 整合測試會在測試所需條件可用時，執行其真實 launch/setup/screencast 程式，否則跳過；不自動安裝依賴。測試的截圖路徑會印在輸出中。Casty 測試涵蓋收到影像的流程，並未自動驗證終端 Kitty 顯示。


若系統已安裝 Chromium／Firefox，可額外執行真實瀏覽器測試（獨立 profile、驗證網頁文字輸入與點擊，不自動安裝依賴）：

```sh
BUNINU_TEST_BROWSERS=1 bun test tests/browser-clients.test.js
```

在本次 proot 環境，測試指令還需加上 `BUNINU_TEST_CHROMIUM_NO_SANDBOX=1`；此變數只停用測試用 Chromium 的 sandbox。一般 `bun test` 會跳過這兩項瀏覽器測試，但會驗證 subsurface 同步、buffer 快照、堆疊和模式切換。

## Linux DRM client 硬體加速

Linux 已有可用的 Mesa driver 與 `/dev/dri/renderD*` 節點時，可以指定 Land 提供給 Wayland client 的 GPU：

```sh
bun index.js -- --linear-dmabuf --drm-device=/dev/dri/renderD129
# 在 client 環境中，使用 Land 印出的 socket：
env WAYLAND_DISPLAY=wayland-buninu glmark2-wayland
# 也可以用實際 PCI 位址，另外指定 client 的 GPU：
env WAYLAND_DISPLAY=wayland-buninu DRI_PRIME=pci-0000_04_00_0 glmark2-wayland
```

以上裝置路徑與 PCI 位址只是範例。可用 `ls -l /sys/class/drm/renderD*/device` 對照硬體，並查看各裝置的 `vendor`、`device` 與 `driver`。Render node 編號可能隨開機改變；Land 的環境與 client 的 chroot 都必須能存取選定的節點。

`--drm-device` 必須搭配 `--linear-dmabuf`，會啟用 linux-dmabuf v4 的預設與各 surface feedback，提供唯讀格式表、選定的 DRM 裝置及 LINEAR ARGB8888／XRGB8888 格式。Mesa 因而能先選到硬體裝置，再套用 `DRI_PRIME`；不需要 udev daemon。舊 client 仍可取得 v3 格式／modifier 事件。不指定 `--drm-device` 時維持原本 v3 路徑；一般無參數啟動仍使用 SHM，不宣告 DMA-BUF。裝置不是 render node 或無法開啟時，啟動會明確失敗。

這加速的是 **client 繪圖**。Land 仍透過 CPU 映射 linear buffer，同步、複製像素，再以軟體合成；不載入 EGL、Vulkan 或 libdrm。不支援提供這類 buffer 的硬體／driver 組合仍無法使用。在 Intel HD Graphics 5500 + Nouveau NV106、Mesa 25.0.7 的真機上，Intel 已確認正確繪圖與持續變化的截圖。Nouveau 雖已選到 NV106 硬體 renderer，但匯入畫面仍為空白或雜訊，因此這條 NVIDIA 路徑目前還不能正常使用。此處 NVIDIA 使用 Mesa Nouveau，並非 NVIDIA 專有 driver。

### 自動 CPU 繪製優化

無旋轉、使用完整 buffer 且實體像素邊界為整數的 surface，預設可以走 JS 直接合成；fractional output scale 下，只要最終為 1:1 或最近鄰放大也可使用。支援堆疊、預乘透明度混色、裁切與符合條件的游標。縮小、裁切來源的 viewport、不支援的次像素座標或變換，以及需要保留原本 XRGB 未使用 alpha 位元組行為的 buffer，會自動退回 CanvasKit。兩條路徑維持相同截圖尺寸；這不是 GPU 合成。

Land 會先把 SHM／DMA-BUF 內容複製成自己持有的不可變快照；環境支援時以 `SharedArrayBuffer` 儲存，renderer worker 可以共用快照，省掉另一次完整像素複製。client 持有的映射不會直接分享給 worker，原有 buffer 釋放與讀取同步仍保留。不支援共享 buffer 的 runtime 會使用一般快照。

PNG 預設維持一般編碼方式。若要減少無損 PNG 壓縮的 CPU 成本，可明確開啟：

```sh
bun index.js -- --fast-png
# 也可以加在既有 engine 參數後，例如：
bun index.js -- --linear-dmabuf --drm-device=/dev/dri/renderD129 --lazy-dmabuf --poll-interval=1 --fast-png
```

`--fast-png` 同時適用於 worker、主執行緒與 CanvasKit fallback。它以較大的 PNG 檔案換取較低編碼成本，不改 JPEG／WebP 設定或 Casty 截圖間隔。i5-5200U 實驗的 1080p PNG 約大一倍，因此仍須考慮終端與網路吞吐量。這個參數只影響請求 PNG 的截圖，不會強制 Casty 選用 PNG。

## Direct Freedreno/KGSL 實驗

目前安裝的自訂 aarch64 Mesa 可以在 Adreno 830 上直接透過 Freedreno 繪製 OpenGL。觀察 Termux X11 的執行行為可見 DRI3 DMA-BUF 提交；未閱讀或複製 Termux X11 原始碼。檢查已安裝的 Mesa EGL 二進位檔發現，成功的 Wayland roundtrip 會跳過既有 KGSL 裝置開啟分支。對獨立副本調整該分支後，已能直接使用 Freedreno 繪製並向 Land 提交 LINEAR DMA-BUF，也驗證了持續變化的截圖。

啟動新的 Land，開啟實驗性 linear DMA-BUF 匯入：

```sh
bun index.js -- --linear-dmabuf --poll-interval=1
```

未指定 `--drm-device` 時，`--linear-dmabuf` 宣告第 3 版協定，只提供明確指定 LINEAR 的 ARGB8888／XRGB8888 格式。匯入器透過 libc mmap 與 DMA-BUF 讀取同步，支援可由 CPU 映射的單平面 buffer；不支援的配置會匯入失敗。預設啟動不宣告此協定。`--poll-interval=1` 降低 socket 輪詢延遲，但增加 CPU 成本；預設仍為 4 ms。`--poll-interval=-1` 以 `setImmediate` 啟用 busy polling，每次輪詢之間讓出事件迴圈，但會持續消耗 CPU。

接著在 **Debian/proot 內**執行，使用 Land 印出的實際 socket：

```sh
WAYLAND_DISPLAY=wayland-buninu bun tests/kgsl-wayland.js
# 或量測十秒：
WAYLAND_DISPLAY=wayland-buninu bun tests/kgsl-wayland.js -b build:duration=10
```

腳本使用已安裝、支援 AArch64 的 `objdump`，尋找唯一一個通往 `loader_open_device("/dev/kgsl-3d0")` 的 Wayland roundtrip 分支，核對反組譯指令與 ELF 內容後，只修改私人暫存副本中的一條指令，不依賴固定檔案雜湊或 offset。可執行 `bun tests/kgsl-wayland.js --check-only`，只檢查相容性而不啟動 client；用 `KGSL_EGL_LIBRARY` 選擇其他 EGL 函式庫，或用 `OBJDUMP` 指定反組譯工具。它不替換系統 Mesa，也不把 EGL 載入 Land。腳本選擇 `kgsl`、清除強制 Gallium／軟體呈現設定，並將 `vblank_mode` 預設為 0。這是針對符合控制流程的自訂 AArch64 Mesa 所做的診斷性修補，不是通用或正式 driver 修正。缺少符號、控制流程不同、匹配不唯一或缺少 KGSL 支援時會拒絕修補。預期 renderer 為 `freedreno`／`Adreno (TM) 830`。

先前十秒、800×600 的 build 場景，以原生 Land 與 1 ms 輪詢測得 465 client FPS；暫時的 busy polling 實驗達到 1125 FPS，Termux X11 在 `vblank_mode=0` 下為 1992 FPS。數字會變動，後來一次短時間 busy polling 測量為 588 FPS。現在可用 `--poll-interval=-1` 選擇 busy polling，仍需手動啟用且會持續消耗 CPU。這些測量僅定期檢查截圖，沒有啟用持續 Casty 串流，不能當成終端顯示 FPS。Land 仍會複製匯入的像素並以 CPU 合成。

### 延後 DMA-BUF 讀取實驗與 renderer worker 測量

Renderer worker 現在預設啟用；`--lazy-dmabuf` 開啟實驗性的延後 DMA-BUF 讀取，必須搭配 `--linear-dmabuf`，預設關閉。啟用 linear DMA-BUF 匯入時，仍相容先前的 `BUNINU_EXPERIMENT_DMABUF_LAZY=1` 環境變數。在原生 Termux 中合併使用：

```sh
bun index.js -- --linear-dmabuf --lazy-dmabuf --poll-interval=-1
```

延後讀取會持有 buffer 與其映射，直到截圖需要像素。尚未擷取就被新幀取代的畫面，直接釋放，不做 CPU 同步或複製；真正擷取的畫面則在 DMA-BUF 讀取同步期間完成複製，之後才釋放。Renderer worker 將 CanvasKit 合成與圖片編碼移出 Wayland socket 執行緒，仍然是軟體繪製；新快照送進 Worker 時會增加一次 structured clone 像素複製，並非零複製 GPU 合成。SHM 維持原本立即建立快照的行為。

原生 Adreno 830 實驗使用相同的 800×600、十秒 glmark2 build 場景、busy polling 與 Casty 真正的 JPEG 串流程式；接收端沒有在終端繪製圖片：

| 模式 | Client FPS | 反向順序重測 |
| --- | ---: | ---: |
| 原有路徑 | 258 | 197 |
| 只延後讀取 | 482 | — |
| 只使用 renderer worker | 631 | — |
| 兩項一起使用 | 1536 | 1115 |
| Termux X11，另外測量 | 1793 | 1262 |

Casty 每秒收到約 17–20 張完整尺寸圖片；client FPS 不等於顯示 FPS。主要收益是減少 client 等待並丟棄中間幀，而不是每秒輸出數千張圖片。溫度與排程會影響結果。原始計時記錄在 `tests/dmabuf-experiment-results.json`。

重跑方式：先在原生 Termux 執行 `bun tests/dmabuf-perf.js`，再於 Debian/proot 執行 `bun tests/dmabuf-benchmark.js --x11`。加上 `--repeat` 可依序測量兩項一起使用與原有路徑。控制程式使用 loopback port 19381 和獨立的 `wayland-dmabuf-perf` socket，不會連接既有 Land。測量會使用上述實驗性 KGSL launcher，因此需要符合其控制流程的 Mesa。測試後請停止控制程式。這些測量不代表通用桌面相容性或終端輸出速度保證。

## 授權

專案原始碼採 MIT，見 `LICENSE`。沿用的 browser 程式、CanvasKit WASM 及其內含元件、Wayland XML 各自的來源與授權，見 `THIRD_PARTY_NOTICES.md`、`LICENSES/`、`SOURCES.md`；第三方授權不被專案的 MIT 宣告取代。


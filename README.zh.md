# Buninu Land

[English](README.md) | 繁體中文

A Wayland compositor in JavaScript and WebAssembly for Bun

> **警告：** 本專案仍處於非常早期的開發階段，功能尚不完整，行為與 API 可能大幅變動，目前不適合日常使用。

用 Bun 直接執行的 Wayland compositor。第一版支援 headless 軟體合成，已用系統的 `weston-simple-shm` 驗證動畫，以及 Casty 的啟動、CDP 設定和畫面接收流程。沒有 build step、npm runtime dependencies 或 GPU 路徑。

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

也可自行從 Casty 啟動：

```sh
export CASTY_BROWSER="$PWD/compositor.js"
bunx @drxiaozhi/casty about:blank
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
- `lib/cdp-server.js`：沿用 browser CDP server，增加兩個可選的原始輸入 hook；未修改原版保留於 `vendor/buninu-browser/cdp-server.js`，差異見 `patches/cdp-input.patch`。`user-agent.js` 也原樣沿用，因此 CDP 保留 Buninu 的相容識別。
- `lib/protocol.js`：使用 `Bun.XML.parse()` 在執行時讀標準 XML，依原始順序處理 opcode／argument。
- `lib/transport.js`：僅以 Bun FFI 載入 libc；Unix socket、`recvmsg`／`SCM_RIGHTS`、非阻塞傳輸、socket lock、FD 清理。
- `lib/compositor.js`：每個 client 的 object table、SHM pool／buffer 生命週期、surface commit、xdg configure／ack、frame callback。
- `lib/renderer.js`：沿用 browser 的 CanvasKit WASM，以 CPU 合成；`lib/frame.js` 原樣沿用 browser 的 `Bun.Image` 編碼工具。

SHM 在 commit 時使用 libc `pread` 複製到 compositor 持有的像素，然後釋放 client buffer。這讓 client 可以安全重用 buffer；也避免 client 截短 mmap backing file 導致 compositor SIGBUS。Pool resource 被銷毀後，只要 buffer 還存在，FD 就仍然保留。

## 第一版範圍

公布 `wl_compositor` v4、`wl_shm` v1、`xdg_wm_base` v1、`wl_output` v2、`wl_seat` v5（滑鼠與鍵盤）、`wl_subcompositor` v1、`wl_data_device_manager` v1。SHM 支援 ARGB8888 與 XRGB8888。第一個一般視窗填滿工作區，保留 8 像素外側間距；新增視窗會分割平鋪區域。約 60 Hz 排程，每次提交仍完整複製 buffer。

Casty 滑鼠與鍵盤事件已轉送 Wayland，包含 JS 產生的 XKB keymap、焦點、基本 popup 與全螢幕 configure，仍屬早期實作。已支援 subsurface 的同步／非同步提交、位置與堆疊。尚未支援觸控、剪貼簿與拖放、GPU／dmabuf、完整 popup 邊界調整，以及全面的協定與角色生命週期驗證。

### 視窗快捷鍵

以下三組對應 [Omarchy v3.3.0](https://github.com/basecamp/omarchy/blob/v3.3.0/default/hypr/bindings/tiling-v2.conf)，將 Super 換成 Ctrl+Alt：

| 快捷鍵 | 操作 |
| --- | --- |
| Ctrl+Alt+方向鍵 | 切換到目前工作區中該方向的視窗 |
| Ctrl+Alt+W | 請求關閉焦點視窗；應用程式仍可能要求確認 |
| Ctrl+Alt+F | 切換全螢幕，再按一次恢復布局 |

全螢幕時切換方向焦點，會將全螢幕轉移到選中的視窗；該方向沒有視窗則不動作。目前只啟用這三組快捷鍵；F6–F9 與 W／方向鍵／Tab 測試圖案均已移除。Tab 組合交回應用程式。實測終端對 Tab 只保留 Shift，所以不使用 Ctrl／Alt+Tab 切換視窗。修改後須重啟 compositor。

協定定義原樣保留，但實作為 JS，並不是 Hyprland C++ 的逐位元複本，也不代表 XML 中每個 request 都已實作。參考來源見 `SOURCES.md`。

## 畫面轉換成本

PNG：SHM BGRA → CanvasKit 軟體合成 → CanvasKit PNG → CDP base64 → Casty 解碼。直接使用 CanvasKit 的 PNG encoder，避免中間的 RGBA／BMP 轉換。

JPEG／WebP：SHM BGRA → CanvasKit 軟體合成 → RGBA readback → BMP 包裝 → Bun.Image 解碼／編碼 → CDP base64 → Casty 解碼。BMP 包裝會額外複製完整畫面，Bun.Image 再解析 BMP；這是沿用 browser 編碼工具的成本，後續應改為能接收 raw pixels 的編碼路徑。現有 CanvasKit WASM 的 JPEG encoder 無法產生結果，因此不能直接替換這段。Casty 本身也會先取得低解析度變動通知，再要求完整截圖，會有額外編碼工作。

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

## 授權

專案原始碼採 MIT，見 `LICENSE`。沿用的 browser 程式、CanvasKit WASM 及其內含元件、Wayland XML 各自的來源與授權，見 `THIRD_PARTY_NOTICES.md`、`LICENSES/`、`SOURCES.md`；第三方授權不被專案的 MIT 宣告取代。


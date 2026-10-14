# Buninu Land

[English](README.md) | 繁體中文

A Wayland compositor in JavaScript and WebAssembly for Bun

> **警告：** 本專案仍處於非常早期的開發階段，功能尚不完整，行為與 API 可能大幅變動，目前不適合日常使用。

用 Bun 直接執行的 Wayland compositor。第一版支援 headless 軟體合成，已用系統的 `weston-simple-shm` 驗證動畫，以及 Casty 的啟動、CDP 設定和畫面接收流程。沒有 build step、npm runtime dependencies 或 GPU 路徑。

## 執行

需要 Linux 或 Android 64-bit（aarch64 或 x86_64），以及提供 `Bun.XML`、`Bun.Image`、`bun:ffi` 的 Bun。`process.platform === 'android'` 時載入 Bionic `libc.so`／`__errno`；Linux 優先載入 `libc.so.6`／`__errno_location`。此次實測為 Linux aarch64、Bun 1.4.3-canary.1，尚未在 Android 原生環境驗證。

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

需先有 Bun。啟動器沿用 browser 的流程：PATH 同時有 npx 與 bun 時使用 npx，否則使用 bunx，再否則使用 bun x。Casty 套件為 `@drxiaozhi/casty`；尚未安裝／快取時，套件執行器可能下載它。npx 保留原有安裝詢問，不加 `--yes`。

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
bun ../casty/index.js about:blank
```

Socket 目錄依序採用明確設定的 `$XDG_RUNTIME_DIR`、`$TMPDIR`、系統暫存目錄。Socket 直接放在該目錄，不另加子目錄；名稱預設 `wayland-buninu`。例如另一個終端：

```sh
WAYLAND_DISPLAY="${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/wayland-buninu" weston-simple-shm
```

Casty 會傳入 `--remote-debugging-port=0`，由系統選擇可用 port；Casty 從 compositor 輸出的 DevTools URL 取得實際 port。手動 headless 啟動預設使用 9222。

Casty 傳入的 Chromium 相容 flags（例如 `--no-sandbox`、`--user-data-dir`、`--disable-*`）目前忽略；`--remote-debugging-port` 與 `--window-size` 會實際生效。

直接 headless 執行：

```sh
bun compositor.js --headless --remote-debugging-port=9222
```

手動 headless 與 Casty 自動啟動擇一使用，避免佔用相同 socket。Casty 的 URL 不會開網頁；顯示的是 Wayland 桌面。

`bun compositor.js --help` 列出選項。預設 socket 是 `wayland-buninu`，預設畫面 800×600。`--socket=NAME` 可選擇其他 socket；`--remote-debugging-port=0` 自動選 port。`BUNINU_LOG=1` 將 Wayland requests 寫到 stderr。

## 結構

- `index.js`：沿用 browser 的套件 launcher，預設啟動 Casty，設定 `CASTY_BROWSER` 指向 compositor。
- `compositor.js`：headless controller、CDP context adapter、生命週期與 CLI。
- `lib/cdp-server.js`：從 buninu-browser 原樣複製，沒有修改。`user-agent.js` 也原樣沿用，因此 CDP 保留 Buninu 的相容識別。
- `lib/protocol.js`：使用 `Bun.XML.parse()` 在執行時讀標準 XML，依原始順序處理 opcode／argument。
- `lib/transport.js`：僅以 Bun FFI 載入 libc；Unix socket、`recvmsg`／`SCM_RIGHTS`、非阻塞傳輸、socket lock、FD 清理。
- `lib/compositor.js`：每個 client 的 object table、SHM pool／buffer 生命週期、surface commit、xdg configure／ack、frame callback。
- `lib/renderer.js`：沿用 browser 的 CanvasKit WASM，以 CPU 合成；`lib/frame.js` 原樣沿用 browser 的 `Bun.Image` 編碼工具。

SHM 在 commit 時使用 libc `pread` 複製到 compositor 持有的像素，然後釋放 client buffer。這讓 client 可以安全重用 buffer；也避免 client 截短 mmap backing file 導致 compositor SIGBUS。Pool resource 被銷毀後，只要 buffer 還存在，FD 就仍然保留。

## 第一版範圍

公布 `wl_compositor` v4、`wl_shm` v1、`xdg_wm_base` v1、`wl_output` v2、`wl_seat` v1。SHM 支援 ARGB8888 與 XRGB8888；支援基本 xdg_toplevel configure／ack、buffer release 與 frame callbacks。視窗置中堆疊，約 60 Hz 排程；每次提交仍完整複製 buffer，damage 尚未用於局部重繪。

這是 `weston-simple-shm` milestone，尚非完整 Wayland compositor：沒有鍵盤／滑鼠／觸控（seat capabilities 為 0）、popup、subsurface、剪貼簿、GPU／dmabuf、視窗管理或互動式移動／縮放。最大化／全螢幕請求目前採 client 自選尺寸；opaque/input regions 尚不參與合成／輸入。Casty 的輸入也尚未轉成 Wayland input events。尚未完成全面的協定錯誤與角色生命週期驗證。

協定定義原樣保留，但實作為 JS，並不是 Hyprland C++ 的逐位元複本，也不代表 XML 中每個 request 都已實作。參考來源見 `SOURCES.md`。

## 畫面轉換成本

PNG：SHM BGRA → CanvasKit 軟體合成 → CanvasKit PNG → CDP base64 → Casty 解碼。直接使用 CanvasKit 的 PNG encoder，避免中間的 RGBA／BMP 轉換。

JPEG／WebP：SHM BGRA → CanvasKit 軟體合成 → RGBA readback → BMP 包裝 → Bun.Image 解碼／編碼 → CDP base64 → Casty 解碼。BMP 包裝會額外複製完整畫面，Bun.Image 再解析 BMP；這是沿用 browser 編碼工具的成本，後續應改為能接收 raw pixels 的編碼路徑。現有 CanvasKit WASM 的 JPEG encoder 無法產生結果，因此不能直接替換這段。Casty 本身也會先取得低解析度變動通知，再要求完整截圖，會有額外編碼工作。

## 驗證

```sh
bun test
```

測試包括協定 XML opcode、FD 參數、分段封包、socket 排他鎖、無效 client 隔離，以及真實 `weston-simple-shm` 動畫和 CDP PNG／JPEG。若沒有已安裝的 weston client，相關測試跳過。若鄰近有 `../casty`，另測其真實 launch/setup/screencast 程式；不自動安裝依賴。測試的截圖路徑會印在輸出中。Casty 測試涵蓋收到影像的流程，並未自動驗證終端 Kitty 顯示。

## 授權與發佈

專案原始碼採 MIT，見 `LICENSE`。沿用的 browser 程式、CanvasKit WASM 及其內含元件、Wayland XML 各自的來源與授權，見 `THIRD_PARTY_NOTICES.md`、`LICENSES/`、`SOURCES.md`；第三方授權不被專案的 MIT 宣告取代。

`package.json` 設定 public npm package、全域 `buninu-land` 指令，沒有 `files` 名單、build/install scripts 或 npm runtime dependencies。`npm pack --dry-run` 可檢查發佈內容；實際上傳使用 `npm publish --access public`。

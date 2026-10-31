#!/usr/bin/env bun
import { join } from 'node:path';
import packageInfo from './package.json' with { type: 'json' };
import { expandGpuOptions } from './lib/gpu-options.js';
import { runtimeDirectory } from './lib/runtime.js';
import { CdpServer } from './lib/cdp-server.js';
import { Wallpaper, wallpaperArgument } from './lib/wallpaper.js';
import { Desktop } from './lib/desktop.js';

export async function start(args = Bun.argv.slice(2)) {
  const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (args.some(arg => ['--version', '-V', '-version'].includes(arg))) { console.log(`${packageInfo.name} ${packageInfo.version}`); return; }
  if (args.some(arg => ['--help', '-h', '-help'].includes(arg))) {
    console.log(`buninu-land: software Wayland compositor (Bun, Linux/Android 64-bit)
  --socket=NAME                   Wayland socket (default: first free wayland-buninu[N])
  --remote-debugging-port=PORT     CDP port (default 9222; 0 selects a free port)
  --window-size=WIDTH,HEIGHT       Output size (default 800,600)
  --wallpaper PATH                 Image; folders/unsupported files use built-in wallpaper.jpg
  --gpu[=PATH], --gpu [PATH]      Linear DMA-BUF + lazy reads + poll 2 ms; optional DRM node
  --linear-dmabuf                 Experimental CPU-readable linear DMA-BUF import
  --drm-device=PATH               DRM render node for v4 feedback (requires --linear-dmabuf)
  --lazy-dmabuf                   Defer DMA-BUF reads (requires --linear-dmabuf)
  --poll-interval=MS              Socket polling, 1–1000 ms; -1 = busy (default 4)
  --fast-png                      Faster lossless PNG encoding; larger images (default)
  --no-fast-png                   Use the normal PNG encoder
  --no-render-worker              Render on the main thread (worker is default)
  --headless                      Accepted; rendering is always headless
  --help, -h                     Show help
  --version, -V                  Show version
Socket directory: XDG_RUNTIME_DIR, then TMPDIR, then the system temp directory.
Casty: export CASTY_BROWSER=/absolute/path/compositor.js
Run clients with WAYLAND_DISPLAY=wayland-buninu weston-simple-shm`); return;
  }
  const wallpaperPath = wallpaperArgument(args);
  args = expandGpuOptions(args);
  const linearDmabuf=args.includes('--linear-dmabuf');
  const drmDevice=option('drm-device',null);
  if(args.includes('--drm-device')||drmDevice==='')throw Error('Use --drm-device=/dev/dri/renderD128');
  if(drmDevice&&!linearDmabuf)throw Error('--drm-device requires --linear-dmabuf');
  if(args.includes('--lazy-dmabuf')&&!linearDmabuf)throw Error('--lazy-dmabuf requires --linear-dmabuf');
  const lazyDmabuf=linearDmabuf&&(args.includes('--lazy-dmabuf')||process.env.BUNINU_EXPERIMENT_DMABUF_LAZY==='1');
  const { Compositor } = await import('./lib/compositor.js');
  const createRenderer = !args.includes('--no-render-worker') && (process.env.BUNINU_RENDER_WORKER??process.env.BUNINU_EXPERIMENT_RENDER_WORKER)!=='0'
    ? (await import('./lib/worker-renderer.js')).createWorkerRenderer
    : (await import('./lib/renderer.js')).createRenderer;
  const runtime = runtimeDirectory();
  const requestedDisplay = option('socket', null);
  if (requestedDisplay !== null && (!requestedDisplay || requestedDisplay.includes('/'))) throw Error('--socket must be a socket name');
  const [width, height] = option('window-size', '800,600').split(',').map(Number);
  const validSize = (w,h) => [w,h].every(v => Number.isInteger(v) && v > 0 && v <= 8192) && w*h <= 16777216;
  if (!validSize(width,height)) throw Error('Invalid output size');
  let compositor, display;
  for (let number = 0; number < 1000; number++) {
    display = requestedDisplay ?? `wayland-buninu${number || ''}`;
    try { compositor = new Compositor({ socket: join(runtime, display), width, height, linearDmabuf, lazyDmabuf, drmDevice, pollInterval:Number(option('poll-interval','4')) }); break; }
    catch (error) { if (requestedDisplay !== null || error.code !== 'EADDRINUSE') throw error; }
  }
  if (!compositor) throw Error('No free Wayland socket among wayland-buninu through wayland-buninu999');
  let server, shutdown, renderer, desktop;
  const wallpaper = new Wallpaper({changed:()=>compositor.onFrame?.()});
  const surfaces=compositor.wm.renderSurfaces.bind(compositor.wm),origin=compositor.wm.origin.bind(compositor.wm);
  // A wallpaper is render-only: never expose it to window-manager hit testing.
  const renderCompositor=Object.create(compositor);
  renderCompositor.wm=Object.create(compositor.wm);
  renderCompositor.wm.renderSurfaces=()=>{
    const list=wallpaper.surface?[wallpaper.surface,...surfaces()]:surfaces();
    const modal=desktop?.dialogs?.surface;return modal?[...list,modal]:list;
  };
  renderCompositor.wm.origin=s=>s.wallpaper||s.desktopDialog?{x:0,y:0}:origin(s);
  const close = () => { if (!compositor.closed) { compositor.closed = true; server?.stop(true); desktop?.close(); wallpaper.close(); renderer?.close(); compositor.close(); if (shutdown) { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); } } };
  try {
    compositor.fastPng = args.filter(arg => arg === '--fast-png' || arg === '--no-fast-png').at(-1) !== '--no-fast-png';
    if(wallpaperPath!==null)await wallpaper.set(wallpaperPath);
    renderer = await createRenderer(renderCompositor);
    // Serialize preparation with captures so competing viewport sizes never
    // substitute each other's background; worker scene snapshots stay immutable.
    let captures=Promise.resolve(),queuedCaptures=0;
    const screenshot=(options={})=>{
      if(queuedCaptures>=8)return Promise.reject(Error('Renderer screenshot queue is full'));
      queuedCaptures++;
      const run=captures.then(async()=>{
        if(compositor.closed)throw Error('Compositor closed');
        const v=options.viewport;
        await wallpaper.prepare(v?.width??compositor.width,v?.height??compositor.height,v?.deviceScaleFactor??compositor.deviceScaleFactor??1);
        return renderer.screenshot(options);
      }).finally(()=>queuedCaptures--);
      // The queue retains no resolved screenshot string or raw-frame result.
      captures=run.then(()=>{},()=>{});return run;
    };
    desktop=new Desktop({compositor,wallpaper,screenshot});
    const context = {
      desktopTarget: { url: join(runtime, display), width, height },
      onFrame(fn) { compositor.onFrame = fn; },
      dispatchMouseEvent: p => desktop.mouse(p),
      dispatchKeyEvent: p => desktop.key(p),
      type: text => desktop.type(text),
      resolveNavigationUrl(url) { return /^\s*javascript:/i.test(String(url))?String(url).trim():join(runtime, display); },
      navigate(url) {
        if(!/^\s*javascript:/i.test(String(url)))return;
        let source=String(url).trim().replace(/^javascript:/i,'');
        try{source=decodeURIComponent(source);}catch{}
        return desktop.evaluate(source);
      },
      evaluate: expression => desktop.inspect(expression),
      title() { return 'Buninu Land'; },
      onDialog(fn){desktop.dialogListener=fn;},
      get dialogState(){return desktop.dialogState;},
      handleDialog:result=>desktop.handleDialog(result),
      resize(w,h,deviceScaleFactor=1) { if (!validSize(w,h) || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor<=0 || deviceScaleFactor>8 || !validSize(Math.max(1,Math.floor(w*deviceScaleFactor)),Math.max(1,Math.floor(h*deviceScaleFactor)))) throw Error('Invalid viewport'); compositor.width=w; compositor.height=h; compositor.deviceScaleFactor=deviceScaleFactor; compositor.updatePreferredScale(); compositor.wm.layout();
        for(const c of compositor.clients)for(const o of c.objects.values())if(o.iface==='wl_output'){c.event(o,'mode',3,w,h,60000);if(o.version>=2)c.event(o,'done');} return desktop.resize(w,h,deviceScaleFactor); },
      screenshot: options => desktop.screenshot(options),
      cdp(method) {
        if(method==='Page.getLayoutMetrics') {
          const visual={pageX:0,pageY:0,offsetX:0,offsetY:0,clientWidth:compositor.width,clientHeight:compositor.height,scale:1,zoom:1};
          return {cssVisualViewport:visual,cssLayoutViewport:visual,visualViewport:visual,layoutViewport:visual};
        }
        return {};
      },
      close,
    };
    server = CdpServer.create(context).listen(Number(option('remote-debugging-port', '9222')));
    if(compositor.dmabufFeedback)console.error(`DMA-BUF v4 device: ${compositor.dmabufFeedback.path} (linear CPU readback)`);
    console.error(`XDG_RUNTIME_DIR=${runtime}`);
    console.error(`WAYLAND_DISPLAY=${join(runtime, display)}`);
    console.error(`DevTools listening on ws://127.0.0.1:${server.port}/devtools/browser/cdp-server`);
    shutdown = () => { close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return { compositor, server, context, close, display, wallpaper, desktop };
  } catch (e) { close(); throw e; }
}
if (import.meta.main) await start();

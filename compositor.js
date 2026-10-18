#!/usr/bin/env bun
import { join } from 'node:path';
import packageInfo from './package.json' with { type: 'json' };
import { runtimeDirectory } from './lib/runtime.js';
import { CdpServer } from './lib/cdp-server.js';

export async function start(args = Bun.argv.slice(2)) {
  const option = (name, fallback) => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
  if (args.some(arg => ['--version', '-V', '-version'].includes(arg))) { console.log(`${packageInfo.name} ${packageInfo.version}`); return; }
  if (args.some(arg => ['--help', '-h', '-help'].includes(arg))) {
    console.log(`buninu-land: software Wayland compositor (Bun, Linux/Android 64-bit)
  --socket=NAME                   Wayland socket (default: first free wayland-buninu[N])
  --remote-debugging-port=PORT     CDP port (default 9222; 0 selects a free port)
  --window-size=WIDTH,HEIGHT       Output size (default 800,600)
  --linear-dmabuf                 Experimental CPU-readable linear DMA-BUF import
  --poll-interval=MS              Socket polling, 1–1000 ms; -1 = busy (default 4)
  --headless                      Accepted; rendering is always headless
  --help, -h                     Show help
  --version, -V                  Show version
Socket directory: XDG_RUNTIME_DIR, then TMPDIR, then the system temp directory.
Casty: export CASTY_BROWSER=/absolute/path/compositor.js
Run clients with WAYLAND_DISPLAY=wayland-buninu weston-simple-shm`); return;
  }
  const { Compositor } = await import('./lib/compositor.js');
  const { createRenderer } = await import('./lib/renderer.js');
  const runtime = runtimeDirectory();
  const requestedDisplay = option('socket', null);
  if (requestedDisplay !== null && (!requestedDisplay || requestedDisplay.includes('/'))) throw Error('--socket must be a socket name');
  const [width, height] = option('window-size', '800,600').split(',').map(Number);
  const validSize = (w,h) => [w,h].every(v => Number.isInteger(v) && v > 0 && v <= 8192) && w*h <= 16777216;
  if (!validSize(width,height)) throw Error('Invalid output size');
  let compositor, display;
  for (let number = 0; number < 1000; number++) {
    display = requestedDisplay ?? `wayland-buninu${number || ''}`;
    try { compositor = new Compositor({ socket: join(runtime, display), width, height, linearDmabuf:args.includes('--linear-dmabuf'), pollInterval:Number(option('poll-interval','4')) }); break; }
    catch (error) { if (requestedDisplay !== null || error.code !== 'EADDRINUSE') throw error; }
  }
  if (!compositor) throw Error('No free Wayland socket among wayland-buninu through wayland-buninu999');
  let server, shutdown, renderer;
  const close = () => { if (!compositor.closed) { compositor.closed = true; server?.stop(true); renderer?.close(); compositor.close(); if (shutdown) { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); } } };
  try {
    renderer = await createRenderer(compositor);
    const context = {
      onFrame(fn) { compositor.onFrame = fn; },
      dispatchMouseEvent: p => compositor.input.mouse(p),
      dispatchKeyEvent: p => compositor.input.key(p),
      type: text => compositor.input.type(text),
      navigate() {}, title() { return 'Buninu Land'; },
      resize(w,h,deviceScaleFactor=1) { if (!validSize(w,h) || !Number.isFinite(deviceScaleFactor) || deviceScaleFactor<=0 || deviceScaleFactor>8 || !validSize(Math.max(1,Math.floor(w*deviceScaleFactor)),Math.max(1,Math.floor(h*deviceScaleFactor)))) throw Error('Invalid viewport'); compositor.width=w; compositor.height=h; compositor.deviceScaleFactor=deviceScaleFactor; compositor.updatePreferredScale(); compositor.wm.layout();
        for(const c of compositor.clients)for(const o of c.objects.values())if(o.iface==='wl_output'){c.event(o,'mode',3,w,h,60000);if(o.version>=2)c.event(o,'done');} },
      screenshot: options => renderer.screenshot(options),
      close,
    };
    server = CdpServer.create(context).listen(Number(option('remote-debugging-port', '9222')));
    console.error(`XDG_RUNTIME_DIR=${runtime}`);
    console.error(`WAYLAND_DISPLAY=${join(runtime, display)}`);
    console.error(`DevTools listening on ws://127.0.0.1:${server.port}/devtools/browser/cdp-server`);
    shutdown = () => { close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return { compositor, server, context, close, display };
  } catch (e) { close(); throw e; }
}
if (import.meta.main) await start();

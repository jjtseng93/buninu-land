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
  --socket=NAME                   Wayland socket (default wayland-buninu)
  --remote-debugging-port=PORT     CDP port (default 9222; 0 selects a free port)
  --window-size=WIDTH,HEIGHT       Output size (default 800,600)
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
  const display = option('socket', 'wayland-buninu');
  if (!display || display.includes('/')) throw Error('--socket must be a socket name');
  const [width, height] = option('window-size', '800,600').split(',').map(Number);
  const validSize = (w,h) => [w,h].every(v => Number.isInteger(v) && v > 0 && v <= 8192) && w*h <= 16777216;
  if (!validSize(width,height)) throw Error('Invalid output size');
  const compositor = new Compositor({ socket: join(runtime, display), width, height });
  let server, shutdown;
  const close = () => { if (!compositor.closed) { compositor.closed = true; server?.stop(true); compositor.close(); if (shutdown) { process.removeListener('SIGINT', shutdown); process.removeListener('SIGTERM', shutdown); } } };
  try {
    const renderer = await createRenderer(compositor);
    const context = {
      onFrame(fn) { compositor.onFrame = fn; },
      navigate() {}, title() { return 'Buninu Land'; },
      resize(w,h) { if (!validSize(w,h)) throw Error('Invalid viewport'); compositor.width=w; compositor.height=h; compositor.onFrame?.(); },
      screenshot: options => renderer.screenshot(options),
      close,
    };
    server = CdpServer.create(context).listen(Number(option('remote-debugging-port', '9222')));
    console.error(`XDG_RUNTIME_DIR=${runtime}`);
    console.error(`WAYLAND_DISPLAY=${join(runtime, display)}`);
    console.error(`DevTools listening on ws://127.0.0.1:${server.port}/devtools/browser/cdp-server`);
    shutdown = () => { close(); process.exit(0); };
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
    return { compositor, server, context, close };
  } catch (e) { close(); throw e; }
}
if (import.meta.main) await start();

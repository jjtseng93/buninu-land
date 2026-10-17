import { test, expect } from 'bun:test';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const available = existsSync(new URL('../../casty/lib/browser.js', import.meta.url)) && Bun.which('weston-simple-shm');
for (const fallback of [false, true]) test.skipIf(!available)(`Casty launches and streams with ${fallback ? 'automatic' : 'explicit'} runtime directory`, async () => {
  const { launchChrome } = await import('../../casty/lib/chrome.js');
  const { setupPage, startScreencast, stopScreencast } = await import('../../casty/lib/browser.js');
  const oldRuntime = process.env.XDG_RUNTIME_DIR, oldBrowser = process.env.CASTY_BROWSER, oldTmp = process.env.TMPDIR;
  const runtime = mkdtempSync(join(tmpdir(), 'buninu-land-casty-'));
  if (fallback) { delete process.env.XDG_RUNTIME_DIR; process.env.TMPDIR = runtime; }
  else process.env.XDG_RUNTIME_DIR = runtime;
  const socketDirectory = runtime;
  process.env.CASTY_BROWSER = Bun.fileURLToPath(new URL('../compositor.js', import.meta.url));
  let browser, client, capture, weston;
  try {
    browser = await launchChrome({ userDataDir: join(runtime, 'profile'), windowSize: { width: 640, height: 480 } });
    // Exercise reduced zoom through the actual Casty setup and JPEG stream.
    ({ client } = await setupPage(browser, { width: 640, height: 480, zoom: fallback ? .5 : 1 }));
    await client.send('Page.navigate', { url: 'about:blank' });
    // With XDG_RUNTIME_DIR set, clients resolve the relative display name.
    // Without it, an absolute display path supports the TMPDIR fallback.
    weston = Bun.spawn(['weston-simple-shm'], { env: { ...process.env, WAYLAND_DISPLAY:fallback ? join(socketDirectory, 'wayland-buninu') : 'wayland-buninu' }, stdout:'ignore', stderr:'pipe' });
    const frames = [];
    capture = await startScreencast(client, {width:640,height:480,format:'jpeg',onFrame: data => frames.push(data)});
    for (let i=0; i<100 && new Set(frames).size < 5; i++) await Bun.sleep(30);
    expect(weston.exitCode).toBeNull();
    expect(new Set(frames).size).toBeGreaterThanOrEqual(5);
    const image = new Bun.Image(Buffer.from(frames.at(-1), 'base64'));
    const metadata = await image.metadata();
    expect(metadata.width).toBe(640); expect(metadata.height).toBe(480);
    console.log(`Casty received ${frames.length} frames`);
  } finally {
    if (capture) await stopScreencast(client,capture.cleanup);
    client?.close(); weston?.kill(); if (weston) await weston.exited;
    if (browser) { const exited = new Promise(resolve => browser.proc.once('exit', resolve)); browser.proc.kill(); await exited; }
    if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR=oldTmp;
    if (oldRuntime === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR=oldRuntime;
    if (oldBrowser === undefined) delete process.env.CASTY_BROWSER; else process.env.CASTY_BROWSER=oldBrowser;
  }
},15000);

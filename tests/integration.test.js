import { test, expect } from 'bun:test';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../compositor.js';

test.skipIf(!Bun.which('weston-simple-shm'))('weston-simple-shm animates and CDP delivers PNG and JPEG', async () => {
  const previous = process.env.XDG_RUNTIME_DIR;
  const runtime = mkdtempSync(join(tmpdir(), 'buninu-land-'));
  process.env.XDG_RUNTIME_DIR = runtime;
  const app = await start(['--remote-debugging-port=0']);
  let child, ws;
  try {
    child = Bun.spawn(['weston-simple-shm'], { env: { ...process.env, XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: 'wayland-buninu' }, stdout: 'pipe', stderr: 'pipe' });
    for (let i = 0; i < 100 && app.compositor.frames < 5; i++) await Bun.sleep(25);
    expect(child.exitCode).toBeNull();
    expect(app.compositor.frames).toBeGreaterThan(4);
    const first = await app.context.screenshot({ format: 'png' });
    await Bun.write(join(runtime, 'weston.png'), Buffer.from(first, 'base64'));
    await Bun.sleep(100);
    expect(await app.context.screenshot({ format: 'png' })).not.toBe(first);
    ws = new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
    await new Promise((resolve,reject) => { ws.onopen=resolve; ws.onerror=reject; });
    let id = 0; const pending = new Map(), frames = [];
    ws.onmessage = ({data}) => { const m = JSON.parse(data); if (m.id) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } else if (m.method === 'Page.screencastFrame') frames.push(m); };
    const call = (method, params={}, sessionId) => new Promise((resolve,reject) => { const n = ++id; pending.set(n,{resolve,reject}); ws.send(JSON.stringify({id:n,method,params,sessionId})); });
    const { targetId } = await call('Target.createTarget', {url:'about:blank'});
    const { sessionId } = await call('Target.attachToTarget', {targetId,flatten:true});
    const png = await call('Page.captureScreenshot', {format:'png'}, sessionId);
    expect(Buffer.from(png.data,'base64').subarray(1,4).toString()).toBe('PNG');
    await call('Page.startScreencast', {format:'jpeg',quality:75,maxWidth:800,maxHeight:600},sessionId);
    for (let i = 0; i < 100 && frames.length < 3; i++) await Bun.sleep(25);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(Buffer.from(frames[0].params.data,'base64').subarray(0,2)).toEqual(Buffer.from([255,216]));
    expect(frames[0].params.data).not.toBe(frames.at(-1).params.data);
    await call('Page.stopScreencast', {}, sessionId);
    console.log(`Verified ${app.compositor.frames} frames; screenshot: ${runtime}/weston.png`);
  } finally {
    ws?.close(); child?.kill(); if (child) { await child.exited; const errors = await new Response(child.stderr).text(); if (errors) console.log(errors); }
    app.close(); if (previous === undefined) delete process.env.XDG_RUNTIME_DIR; else process.env.XDG_RUNTIME_DIR=previous;
  }
}, 15000);

test.skipIf(!existsSync(new URL('../../buninu-browser/lib/cdp-server.js', import.meta.url)))('CDP server is byte-for-byte unchanged from buninu-browser', () => {
  expect(readFileSync(new URL('../lib/cdp-server.js',import.meta.url))).toEqual(readFileSync(new URL('../../buninu-browser/lib/cdp-server.js',import.meta.url)));
});

// Pins copied assets even when the sibling source checkout is unavailable.
test('vendored code, WASM, and protocol XML match recorded bytes', async () => {
  const manifest = await Bun.file(new URL('../vendor-manifest.json', import.meta.url)).json();
  for (const [path, expected] of Object.entries(manifest)) {
    const bytes = await Bun.file(new URL('../' + path, import.meta.url)).arrayBuffer();
    expect(new Bun.CryptoHasher('sha256').update(bytes).digest('hex')).toBe(expected);
  }
});

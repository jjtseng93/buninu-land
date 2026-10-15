import { test, expect } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { start } from '../compositor.js';

// Exercises Qt's actual xdg-shell/SHM client, not a synthetic protocol fixture.
// This test checks startup and painting; window shortcuts have a separate integration test.
test.skipIf(!Bun.which('konsole'))('Konsole maps and paints through Qt Wayland SHM', async () => {
  const previous = process.env.XDG_RUNTIME_DIR;
  const runtime = mkdtempSync(join(tmpdir(), 'buninu-land-konsole-test-'));
  process.env.XDG_RUNTIME_DIR = runtime;
  let app, child, stderr;
  try {
    app = await start(['--remote-debugging-port=0']);
    child = Bun.spawn(['konsole', '--separate', '--nofork', '-e', '/bin/sh', '-c',
      'printf "Buninu Land Qt Wayland test\\n"; exec sleep 30'], {
      env: { ...process.env, XDG_RUNTIME_DIR: runtime, WAYLAND_DISPLAY: 'wayland-buninu', QT_QPA_PLATFORM: 'wayland' },
      stdout: 'ignore', stderr: 'pipe',
    });
    stderr = new Response(child.stderr).text();
    let surface;
    for (let i = 0; i < 200; i++) {
      surface = [...app.compositor.surfaces].find(s => s.xdg?.toplevel?.appId === 'org.kde.konsole' && s.pixels);
      if (surface || child.exitCode !== null) break;
      await Bun.sleep(25);
    }
    if (child.exitCode !== null) throw Error(`Konsole exited (${child.exitCode}): ${await stderr}`);
    expect(surface).toBeDefined();
    expect(surface.xdg.acked).toBe(true);
    expect(surface.pixels.width).toBeGreaterThan(100);
    expect(surface.pixels.height).toBeGreaterThan(100);
    // Wait beyond the initial configure/paint to catch delayed protocol errors.
    await Bun.sleep(250);
    expect(child.exitCode).toBeNull();
    expect(app.compositor.surfaces.has(surface)).toBe(true);
    const png = Buffer.from(await app.context.screenshot({ format: 'png' }), 'base64');
    expect(png.subarray(1, 4).toString()).toBe('PNG');
    await Bun.write(join(runtime, 'konsole.png'), png);
    console.log(`Konsole screenshot: ${runtime}/konsole.png`);
  } finally {
    child?.kill();
    if (child) { await child.exited; await stderr; }
    app?.close();
    if (previous === undefined) delete process.env.XDG_RUNTIME_DIR;
    else process.env.XDG_RUNTIME_DIR = previous;
  }
}, 10000);

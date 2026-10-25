import {test, expect} from 'bun:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Compositor} from '../lib/compositor.js';

for (const version of [1, 2]) test(`xdg-shell v${version} inherits versions and gates tiled states`, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'land-xdg-version-'));
  const socketPath = join(dir, 'wayland-test');
  const comp = new Compositor({socket: socketPath});
  let socket;
  try {
    socket = await Bun.connect({unix: socketPath, socket: {data(){}, error(){}, close(){}}});
    for (let i = 0; i < 100 && !comp.clients.size; i++) await Bun.sleep(5);
    const client = [...comp.clients][0];
    const registry = client.add(2, 'wl_registry');
    const index = comp.globals.findIndex(([name]) => name === 'xdg_wm_base');
    expect(comp.globals[index][1]).toBe(2);
    client.request(registry, 'bind', [index + 1, 'xdg_wm_base', version, 3]);
    const base = client.object(3);
    const factory = client.add(4, 'wl_compositor', 4);
    client.request(factory, 'create_surface', [5]);
    client.request(base, 'get_xdg_surface', [6, 5]);
    const xdg = client.object(6);
    client.request(xdg, 'get_toplevel', [7]);
    client.request(base, 'create_positioner', [8]);
    for (const id of [6, 7, 8]) expect(client.object(id).version).toBe(version);
    client.request(factory, 'create_surface', [9]);
    client.request(base, 'get_xdg_surface', [10, 9]);
    client.request(client.object(8), 'set_size', [20, 20]);
    client.request(client.object(8), 'set_anchor_rect', [0, 0, 20, 20]);
    client.request(client.object(10), 'get_popup', [11, 6, 8]);
    expect(client.object(11).version).toBe(version);
    const configurations = [];
    const send = client.event.bind(client);
    client.event = (object, name, ...args) => {
      if (object.id === 7 && name === 'configure') {
        const bytes = args[2];
        configurations.push(Array.from({length: bytes.length / 4}, (_, i) => bytes.readUInt32LE(i * 4)));
      }
      send(object, name, ...args);
    };
    const window = comp.wm.add(client.object(5));
    expect(configurations.at(-1)).toEqual(version === 2 ? [5, 6, 7, 8] : []);
    comp.wm.toggleFloating(window);
    expect(configurations.at(-1)).toEqual([]);
    comp.wm.fullscreen(window, true);
    expect(configurations.at(-1)).toEqual([2]);
    comp.wm.fullscreen(window, true, true);
    expect(configurations.at(-1)).toEqual([1]);
  } finally {
    socket?.end(); comp.close(); rmSync(dir, {recursive: true, force: true});
  }
});

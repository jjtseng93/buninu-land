import { test, expect } from 'bun:test';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDmabufFeedback } from '../lib/dmabuf-feedback.js';
import { linearFormats } from '../lib/dmabuf.js';
import { Compositor } from '../lib/compositor.js';

// Exercise real file descriptors without requiring a GPU on the test host.
const deviceIO = { ...fs, fstatSync: () => ({ rdev: 0xe281n, isCharacterDevice: () => true }) };
test('feedback table is read-only, unlinked, ordered and closed with its device', () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'land-feedback-'));
  const feedback = openDmabufFeedback('/dev/null', join(dir, 'runtime'), deviceIO);
  try {
    expect(fs.readdirSync(join(dir, 'runtime'))).toEqual([]);
    const table = Buffer.alloc(feedback.size);
    fs.readSync(feedback.tableFd, table, 0, table.length, 0);
    for (let i = 0; i < linearFormats.length; i++) {
      expect(table.readUInt32LE(i * 16)).toBe(linearFormats[i]);
      expect(table.readUInt32LE(i * 16 + 4)).toBe(0);
      expect(table.readBigUInt64LE(i * 16 + 8)).toBe(0n);
      expect(feedback.indices.readUInt16LE(i * 2)).toBe(i);
    }
    expect(() => fs.writeSync(feedback.tableFd, Buffer.from([0]))).toThrow();
    const events = [];
    feedback.send((...args) => events.push(args));
    expect(events.map(e => e[0])).toEqual(['format_table', 'main_device', 'tranche_target_device', 'tranche_flags', 'tranche_formats', 'tranche_done', 'done']);
    expect(events[1][1].readBigUInt64LE()).toBe(0xe281n);
    expect(events[2][1]).toEqual(events[1][1]);
    expect(events[3][1]).toBe(0);
  } finally { feedback.close(); fs.rmSync(dir, { recursive: true }); }
  feedback.close();
  expect(() => fs.fstatSync(feedback.tableFd)).toThrow();
});

test('DRM feedback rejects non-render nodes and requires opt-in', () => {
  expect(() => openDmabufFeedback('/dev/null', tmpdir())).toThrow('DRM render node');
  expect(() => new Compositor({ socket: '/tmp/not-created', drmDevice: '/dev/null' })).toThrow('requires --linear-dmabuf');
  for (const rdev of [0xe200n, 0xe27fn, 0x100e200n]) {
    expect(() => openDmabufFeedback('/dev/null', tmpdir(), { ...deviceIO, fstatSync: () => ({ rdev, isCharacterDevice: () => true }) })).toThrow('DRM render node');
  }
});

test('v4 default and surface feedback coexist with v3 clients', async () => {
  const dir = fs.mkdtempSync(join(tmpdir(), 'land-feedback-wire-'));
  const comp = new Compositor({ socket: join(dir, 'wl'), linearDmabuf: true });
  let socket;
  try {
    expect(comp.globals.at(-1)).toEqual(['zwp_linux_dmabuf_v1', 3]);
    comp.dmabufFeedback = openDmabufFeedback('/dev/null', dir, deviceIO);
    comp.globals = [...comp.globals.slice(0, -1), ['zwp_linux_dmabuf_v1', 4]];
    socket = await Bun.connect({ unix: join(dir, 'wl'), socket: { data() {}, close() {}, error() {} } });
    for (let i = 0; i < 100 && !comp.clients.size; i++) await Bun.sleep(5);
    const client = [...comp.clients][0], events = [];
    client.event = (o, name, ...args) => events.push([o.id, name, ...args]);
    const registry = client.add(2, 'wl_registry'), global = comp.globals.length;
    client.request(registry, 'bind', [global, 'zwp_linux_dmabuf_v1', 4, 3]);
    expect(events).toEqual([]);
    client.request(client.object(3), 'get_default_feedback', [4]);
    expect(events.at(-1)).toEqual([4, 'done']);
    const expected = events.map(e => e.slice(1)); events.length = 0;
    client.request(client.add(9, 'wl_compositor', 4), 'create_surface', [5]);
    client.request(client.object(3), 'get_surface_feedback', [6, 5]);
    expect(events.map(e => e.slice(1))).toEqual(expected);
    expect(() => client.request(client.object(3), 'get_surface_feedback', [7, 999])).toThrow();
    client.request(client.object(6), 'destroy', []);
    expect(() => client.object(6)).toThrow();
    events.length = 0;
    client.request(registry, 'bind', [global, 'zwp_linux_dmabuf_v1', 3, 8]);
    expect(events.filter(e => e[1] === 'modifier').map(e => e.slice(2))).toEqual(linearFormats.map(f => [f, 0, 0]));
  } finally { socket?.end(); comp.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});

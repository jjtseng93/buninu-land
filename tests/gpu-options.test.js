import { test, expect } from 'bun:test';
import { expandGpuOptions } from '../lib/gpu-options.js';
import { start } from '../compositor.js';

test('GPU preset accepts bare, equals and separate absolute device paths', () => {
  const defaults = ['--linear-dmabuf', '--lazy-dmabuf', '--poll-interval=2'];
  expect(expandGpuOptions([])).toEqual([]);
  expect(expandGpuOptions(['--gpu'])).toEqual(defaults);
  for (const args of [['--gpu=/dev/dri/renderD129'], ['--gpu', '/dev/dri/renderD129']])
    expect(expandGpuOptions(args)).toEqual([...defaults, '--drm-device=/dev/dri/renderD129']);
  expect(expandGpuOptions(['--gpu', '--no-fast-png'])).toEqual(['--no-fast-png', ...defaults]);
  for (const value of ['', 'relative']) expect(() => expandGpuOptions(['--gpu=' + value])).toThrow('absolute');
});

test('explicit polling and DRM options override the GPU preset in either order', () => {
  const explicit = ['--poll-interval=4', '--drm-device=/dev/dri/renderD128'];
  for (const args of [['--gpu=/dev/dri/renderD129', ...explicit], [...explicit, '--gpu=/dev/dri/renderD129']])
    expect(expandGpuOptions(args)).toEqual([...explicit, '--linear-dmabuf', '--lazy-dmabuf']);
});

test('bare GPU preset starts without requiring a DRM node', async () => {
  const app = await start(['--gpu', '--remote-debugging-port=0', '--window-size=8,8']);
  try {
    expect(app.compositor.lazyDmabuf).toBe(true);
    expect(app.compositor.transport.busy).toBe(false);
    expect(app.compositor.fastPng).toBe(true);
    expect(await app.context.screenshot()).toBeTruthy();
  } finally { app.close(); }
});

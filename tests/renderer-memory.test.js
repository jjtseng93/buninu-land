import { expect, test } from 'bun:test';
import { createRenderer } from '../lib/renderer.js';

test('render errors propagate, and a closed renderer refuses captures', async () => {
  let fail = false;
  const compositor = { width: 800, height: 600, input: {}, wm: { renderSurfaces() {
    if (fail) throw Error('intentional render failure');
    return [];
  } } };
  const renderer = await createRenderer(compositor);
  try {
    for (let i = 0; i < 3; i++) {
      const png = Buffer.from(await renderer.screenshot(), 'base64');
      expect(png.subarray(1, 4).toString()).toBe('PNG');
    }
    compositor.input.pointer = true;
    for (let i = 0; i < 5; i++) {
      compositor.input.x = i; compositor.input.y = i;
      await renderer.screenshot({ maxWidth: 200 });
    }
    fail = true;
    await expect(renderer.screenshot()).rejects.toThrow('intentional render failure');
    fail = false;
    expect(Buffer.from(await renderer.screenshot(), 'base64').subarray(1, 4).toString()).toBe('PNG');
    renderer.close(); renderer.close();
    await expect(renderer.screenshot()).rejects.toThrow('closed');
  } finally {
    renderer.close();
  }
}, 30000);

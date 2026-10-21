import { expect, test } from 'bun:test';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
import { createRenderer } from '../lib/renderer.js';

test('cached surfaces stay bounded and release pixels on close, including render errors', async () => {
  const CK = await CanvasKitInit({ wasmBinary: await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm', import.meta.url)).arrayBuffer() });
  const malloc = CK._malloc, free = CK._free;
  const allocations = new Map();
  CK._malloc = size => { const ptr = malloc(size); allocations.set(ptr, size); return ptr; };
  CK._free = ptr => { allocations.delete(ptr); return free(ptr); };
  let fail = false;
  const compositor = { width: 800, height: 600, input: {}, wm: { renderSurfaces() {
    if (fail) throw Error('intentional render failure');
    return [];
  } } };
  const renderer = await createRenderer(compositor, { canvasKit: CK, directComposition: false });
  try {
    for (let i = 0; i < 60; i++) {
      const png = Buffer.from(await renderer.screenshot(), 'base64');
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      expect(allocations.size).toBe(1);
    }
    // The async JPEG path reuses the same retained allocation.
    if (Bun.Image) {
      for (let i = 0; i < 10; i++) {
        await renderer.screenshot({ format: 'jpeg' });
        expect(allocations.size).toBe(1);
      }
    }
    // One full-size and one preview target are reused even when the scene changes.
    compositor.input.pointer = true;
    for (let i = 0; i < 20; i++) {
      compositor.input.x = i; compositor.input.y = i;
      await renderer.screenshot({ maxWidth: 200 });
      expect(allocations.size).toBe(2);
    }
    await renderer.screenshot({ viewport: { width: 320, height: 240 }, maxWidth: 80 });
    expect(allocations.size).toBe(2);
    fail = true;
    await expect(renderer.screenshot()).rejects.toThrow('intentional render failure');
    expect(allocations.size).toBe(2);
    renderer.close(); renderer.close();
    expect(allocations.size).toBe(0);
    await expect(renderer.screenshot()).rejects.toThrow('closed');
  } finally {
    renderer.close();
    for (const ptr of allocations.keys()) free(ptr);
    CK._malloc = malloc; CK._free = free;
  }
}, 30000);

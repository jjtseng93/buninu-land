import { surfaceViewport } from "./viewport.js";

// Whole-buffer, unrotated BGRA surfaces with integer physical bounds.
// Upscaling matches the nearest-neighbour CanvasKit path; downscaling falls back.
// Validate the entire scene before drawing. All other geometry uses CanvasKit.
export function createDirectComposer(compositor) {
  let cachedScene, cachedPixels;
  return {
    close() {
      cachedScene = cachedPixels = null;
    },
    compose(width, height, factor = 1) {
      const input = compositor.input,
        cursor = input.cursor,
        rows = [];
      const surfaces = [...compositor.wm.renderSurfaces()];
      if (cursor?.surface?.pixels) surfaces.push(cursor.surface);
      for (const surface of surfaces) {
        const b = surface.pixels;
        if (!b) continue;
        let { x, y } =
          surface === cursor?.surface
            ? { x: input.x - cursor.x, y: input.y - cursor.y }
            : compositor.wm.origin(surface);
        const viewport = surfaceViewport(surface);
        let w = viewport.width * factor, h = viewport.height * factor;
        x *= factor; y *= factor;
        // Match the existing renderer's fractional-client pixel snapping.
        if (surface.fractionalScale && surface.scale === 1 &&
            viewport.source.every((v, i) => v === [0, 0, b.width, b.height][i]) &&
            Math.round(w) === b.width && Math.round(h) === b.height) {
          x = Math.round(x); y = Math.round(y); w = b.width; h = b.height;
        }
        if (
          surface.transform !== 0 ||
          !Number.isSafeInteger(w) || !Number.isSafeInteger(h) ||
          w < b.width || h < b.height ||
          !Number.isSafeInteger(x) ||
          !Number.isSafeInteger(y) ||
          ![0, 1].includes(b.format) ||
          viewport.source.some((v, i) => v !== [0, 0, b.width / surface.scale, b.height / surface.scale][i])
        )
          return null;
        const bytes = b.bytes;
        if (
          !Number.isInteger(b.width) ||
          !Number.isInteger(b.height) ||
          b.width <= 0 ||
          b.height <= 0 ||
          !Number.isInteger(b.stride) ||
          b.stride < b.width * 4 ||
          b.stride % 4 ||
          bytes.byteOffset % 4 ||
          bytes.byteLength < b.stride * b.height
        )
          return null;
        // CanvasKit may preserve unused XRGB alpha bytes in its snapshot. Keep
        // that legacy output on the fallback path instead of changing it here.
        if (b.format === 1) {
          for (let row = 0; row < b.height; row++)
            for (let column = 0; column < b.width; column++)
              if (bytes[row * b.stride + column * 4 + 3] !== 255) return null;
        }
        rows.push([b, x, y, w, h, b.stride, b.format, bytes]);
      }
      const pointer = !cursor && input.pointer;
      if (
        pointer &&
        (factor !== 1 || !Number.isSafeInteger(input.x) || !Number.isSafeInteger(input.y))
      )
        return null;
      const scene = [
        [width, height],
        ...rows,
        pointer ? [input.x, input.y] : [],
      ];
      if (
        cachedScene?.length === scene.length &&
        scene.every(
          (r, i) =>
            r.length === cachedScene[i].length &&
            r.every((v, j) => v === cachedScene[i][j]),
        )
      )
        return cachedPixels;
      const out = new Uint32Array(width * height);
      out.fill(0xff181b22); // opaque background, BGRA bytes (little endian)
      for (const [buffer, x, y, w, h, stride, format, bytes] of rows) {
        const src = new Uint32Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.byteLength / 4),
        );
        const x0 = Math.max(0, x),
          x1 = Math.min(width, x + w);
        const y0 = Math.max(0, y),
          y1 = Math.min(height, y + h);
        for (let yy = y0; yy < y1; yy++) {
          const sourceRow = Math.floor((yy - y + 0.5) * buffer.height / h) * (stride / 4);
          let di = yy * width + x0;
          for (let xx = x0; xx < x1; xx++, di++) {
            const si = sourceRow + Math.floor((xx - x + 0.5) * buffer.width / w);
            const p = src[si],
              alpha = format === 1 ? 255 : p >>> 24;
            if (alpha === 255) {
              out[di] = p | 0xff000000;
              continue;
            }
            if (alpha === 0) continue;
            // Wayland ARGB is premultiplied; the destination stays opaque.
            const q = out[di],
              inverse = 255 - alpha;
            const blue = Math.min(
              255,
              (p & 255) + Math.round(((q & 255) * inverse) / 255),
            );
            const green = Math.min(
              255,
              ((p >>> 8) & 255) +
                Math.round((((q >>> 8) & 255) * inverse) / 255),
            );
            const red = Math.min(
              255,
              ((p >>> 16) & 255) +
                Math.round((((q >>> 16) & 255) * inverse) / 255),
            );
            out[di] = 0xff000000 | (red << 16) | (green << 8) | blue;
          }
        }
      }
      if (pointer) {
        for (
          let y = Math.max(0, input.y);
          y < Math.min(height, input.y + 15);
          y++
        )
          for (
            let x = Math.max(0, input.x);
            x < Math.min(width, input.x + (y < input.y + 3 ? 10 : 3));
            x++
          )
            out[y * width + x] = 0xffffffff;
      }
      cachedScene = scene;
      cachedPixels = out;
      return out;
    },
  };
}

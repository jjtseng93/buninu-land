import { surfaceViewport } from "./viewport.js";

// Whole-buffer, unrotated BGRA surfaces sampled at destination pixel centres.
// Upscaling matches the nearest-neighbour CanvasKit path; downscaling falls back.
// Validate the entire scene before drawing. All other geometry uses CanvasKit.
export function createDirectComposer(compositor, sampleMap) {
  let cachedScene, cachedPixels;
  let opacity = new WeakMap();
  return {
    close() {
      cachedScene = cachedPixels = null;
      opacity = new WeakMap();
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
          !Number.isFinite(w) || !Number.isFinite(h) ||
          w < b.width || h < b.height ||
          !Number.isSafeInteger(x) ||
          !Number.isSafeInteger(y) ||
          ![0, 1].includes(b.format) ||
          viewport.source.some((v, i) => v !== [0, 0, b.width / surface.scale, b.height / surface.scale][i])
        )
          return null;
        if ((!Number.isInteger(w) || !Number.isInteger(h)) &&
            (!sampleMap || surface.scale !== 1 || viewport.width !== b.width || viewport.height !== b.height))
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
        let opaque = opacity.get(b);
        if (opaque === undefined) {
          opaque = true;
          for (let row = 0; row < b.height && opaque; row++)
            for (let column = 0; column < b.width; column++)
              if (bytes[row * b.stride + column * 4 + 3] !== 255) {
                opaque = false; break;
              }
          // Buffer snapshots are immutable; replacement commits use a new key.
          opacity.set(b, opaque);
        }
        if (b.format === 1 && !opaque) return null;
        rows.push([b, x, y, w, h, b.stride, b.format, bytes, opaque]);
      }
      const pointer = !cursor && input.pointer;
      const scene = [
        [width, height],
        ...rows,
        pointer ? [input.x, input.y, factor] : [],
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
      for (const [buffer, x, y, w, h, stride, format, bytes, opaque] of rows) {
        const src = new Uint32Array(
          bytes.buffer,
          bytes.byteOffset,
          Math.floor(bytes.byteLength / 4),
        );
        const x0 = Math.max(0, Math.ceil(x - 0.5)),
          x1 = Math.min(width, Math.round(x + w));
        const y0 = Math.max(0, Math.ceil(y - 0.5)),
          y1 = Math.min(height, Math.round(y + h));
        if (x1 <= x0 || y1 <= y0) continue;
        const count = x1 - x0;
        const fractional = !Number.isInteger(w) || !Number.isInteger(h);
        const mappedX = fractional ? sampleMap(buffer.width, factor, x, width, false) : null;
        const mappedY = fractional ? sampleMap(buffer.height, factor, y, height, true) : null;
        const columns = new Int32Array(count);
        for (let i = 0; i < count; i++)
          columns[i] = mappedX ? mappedX[x0 + i] : Math.max(0, Math.min(buffer.width - 1, Math.floor((x0 + i - x + 0.5) * buffer.width / w)));
        let previousSourceRow = -1, previousOutputRow = 0;
        for (let yy = y0; yy < y1; yy++) {
          const sourceRow = (mappedY ? mappedY[yy] : Math.max(0, Math.min(buffer.height - 1, Math.floor((yy - y + 0.5) * buffer.height / h)))) * (stride / 4);
          let di = yy * width + x0;
          if (opaque) {
            if (sourceRow === previousSourceRow) {
              out.copyWithin(di, previousOutputRow, previousOutputRow + count);
            } else if (w === buffer.width && Number.isInteger(x)) {
              out.set(src.subarray(sourceRow + x0 - x, sourceRow + x1 - x), di);
            } else {
              for (let i = 0; i < count; i++) out[di + i] = src[sourceRow + columns[i]];
            }
            previousSourceRow = sourceRow;
            previousOutputRow = di;
            continue;
          }
          // Translucent rows must blend against each destination row separately.
          for (let xx = x0; xx < x1; xx++, di++) {
            const si = sourceRow + columns[xx - x0];
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
        // CanvasKit draws two non-antialiased rectangles in logical coordinates.
        for (const [w, h] of [[3, 15], [10, 3]]) {
          const x0 = Math.max(0, Math.round(input.x * factor));
          const x1 = Math.min(width, Math.round((input.x + w) * factor));
          const y0 = Math.max(0, Math.round(input.y * factor));
          const y1 = Math.min(height, Math.round((input.y + h) * factor));
          if (x1 <= x0 || y1 <= y0) continue;
          for (let y = y0; y < y1; y++)
            out.fill(0xffffffff, y * width + x0, y * width + x1);
        }
      }
      cachedScene = scene;
      cachedPixels = out;
      return out;
    },
  };
}

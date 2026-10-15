import { encodeImage } from './frame.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
export async function createRenderer(compositor, { canvasKit } = {}) {
  const CK = canvasKit ?? await CanvasKitInit({ wasmBinary: await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm', import.meta.url)).arrayBuffer() });
  return {
    async screenshot({ format = 'png', quality = 80, viewport, maxWidth, maxHeight } = {}) {
      const width = viewport?.width ?? compositor.width, height = viewport?.height ?? compositor.height;
      if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 8192) || width * height > 16777216) throw Error('Invalid capture size');
      if ([maxWidth, maxHeight].some(v => v !== undefined && (!Number.isFinite(v) || v <= 0))) throw Error('Invalid capture limit');
      const factor = Math.min(1, (maxWidth || width) / width, (maxHeight || height) / height);
      const target = CK.MakeSurface(Math.max(1, Math.floor(width * factor)), Math.max(1, Math.floor(height * factor)));
      if (!target) throw Error('Cannot allocate software surface');
      let paint;
      try {
        const canvas = target.getCanvas();
        paint = new CK.Paint();
        canvas.clear(CK.Color(24, 27, 34, 1)); canvas.scale(factor, factor);
        const cursor=compositor.input.cursor;
        const surfaces=compositor.wm.renderSurfaces();
        if(cursor?.surface?.pixels)surfaces.push(cursor.surface);
        for (const surface of surfaces) {
          const b = surface.pixels;
          if (!b) continue;
          const image = CK.MakeImage({ width: b.width, height: b.height,
            alphaType: b.format === 1 ? CK.AlphaType.Opaque : CK.AlphaType.Premul,
            colorType: CK.ColorType.BGRA_8888, colorSpace: CK.ColorSpace.SRGB }, b.bytes, b.stride);
          if (!image) continue;
          try {
            canvas.save();
            const rotation = surface.transform & 3, flip = surface.transform & 4;
            const w = rotation % 2 ? b.height : b.width, h = rotation % 2 ? b.width : b.height;
            const origin=surface===cursor?.surface?{x:compositor.input.x-cursor.x,y:compositor.input.y-cursor.y}:compositor.wm.origin(surface);
            canvas.translate(origin.x,origin.y);
            canvas.scale(1 / surface.scale, 1 / surface.scale);
            // wl_output_transform describes the buffer transform; display its inverse.
            if (flip) { canvas.translate(w, 0); canvas.scale(-1, 1); }
            if (rotation === 1) { canvas.translate(0, b.width); canvas.rotate(-90, 0, 0); }
            if (rotation === 2) { canvas.translate(b.width, b.height); canvas.rotate(180, 0, 0); }
            if (rotation === 3) { canvas.translate(b.height, 0); canvas.rotate(90, 0, 0); }
            canvas.drawImage(image, 0, 0, paint); canvas.restore();
          } finally { image.delete(); }
        }
        if(!cursor&&compositor.input.pointer){paint.setColor(CK.Color(255,255,255,1));canvas.drawRect(CK.XYWHRect(compositor.input.x,compositor.input.y,3,15),paint);canvas.drawRect(CK.XYWHRect(compositor.input.x,compositor.input.y,10,3),paint);}
        target.flush(); const image = target.makeImageSnapshot();
        try {
          // CanvasKit already has a PNG encoder: avoid readPixels + BMP + image decode.
          if (format === 'png') return Buffer.from(image.encodeToBytes(CK.ImageFormat.PNG, 100)).toString('base64');
          const info = { width: image.width(), height: image.height(), colorType: CK.ColorType.RGBA_8888, alphaType: CK.AlphaType.Unpremul, colorSpace: CK.ColorSpace.SRGB };
          const pixels = image.readPixels(0, 0, info);
          return Buffer.from(await encodeImage(pixels, info.width, info.height, { format, quality })).toString('base64');
        }
        finally { image.delete(); }
      } finally {
        try { paint?.delete(); } finally {
          // MakeSurface owns a separate WASM pixel allocation; delete() alone
          // destroys the SkSurface but leaks that allocation on every capture.
          target.dispose();
        }
      }
    },
  };
}

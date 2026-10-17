import { encodeImage } from './frame.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
export async function createRenderer(compositor, { canvasKit } = {}) {
  const CK = canvasKit ?? await CanvasKitInit({ wasmBinary: await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm', import.meta.url)).arrayBuffer() });
  // SHM snapshots are immutable: each applied buffer commit replaces pixels.
  const images = new Map();
  const paint = new CK.Paint();
  let full, preview, closed = false;
  function release(view) { if (view) { view.image?.delete(); view.target.dispose(); } }
  function allocate(width, height) {
    const target = CK.MakeSurface(width, height);
    if (!target) throw Error('Cannot allocate software surface');
    return { target, width, height, image: null };
  }
  function sameScene(a, b) {
    return a && a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((v, j) => v === b[i][j]));
  }
  function compose(width, height, factor, outWidth, outHeight, isFull, smooth) {
    const cursor = compositor.input.cursor;
    const surfaces = [...compositor.wm.renderSurfaces()];
    if (cursor?.surface?.pixels) surfaces.push(cursor.surface);
    // Include geometry, ordering and cursor state, not only buffer commits.
    const next = surfaces.filter(s => s.pixels).map(s => {
      const origin = s === cursor?.surface ? { x: compositor.input.x - cursor.x, y: compositor.input.y - cursor.y } : compositor.wm.origin(s);
      return [s.pixels, origin.x, origin.y, s.scale, s.transform];
    });
    const pointer = !cursor && compositor.input.pointer;
    next.push(pointer ? ['pointer', compositor.input.x, compositor.input.y] : ['no-pointer']);
    let view = isFull ? full : preview;
    if (view?.width !== outWidth || view.height !== outHeight) {
      release(view); if (isFull) full = null; else preview = null;
      view = allocate(outWidth, outHeight);
      if (isFull) full = view; else preview = view;
    }
    if (view.image && view.sourceWidth === width && view.sourceHeight === height && view.factor === factor && view.smooth === smooth && sameScene(view.scene, next)) return view.image;
    view.scene = null; view.image?.delete(); view.image = null;
    view.sourceWidth = width; view.sourceHeight = height; view.factor = factor; view.smooth = smooth;
    const visible = new Set(next.slice(0, -1).map(row => row[0]));
    for (const [pixels, image] of images) if (!visible.has(pixels)) { image.delete(); images.delete(pixels); }
    const canvas = view.target.getCanvas();
    canvas.clear(CK.Color(24, 27, 34, 1));
    canvas.save();
    try {
      // A preview must never force an expensive full-size repaint. Reuse the
      // full image only when it already represents this exact scene/viewport.
      if (!isFull && full?.image && full.sourceWidth === width && full.sourceHeight === height && full.factor >= factor && sameScene(full.scene, next)) {
        canvas.scale(factor / full.factor, factor / full.factor);
        if (smooth) canvas.drawImageOptions(full.image, 0, 0, CK.FilterMode.Linear, CK.MipmapMode.None, paint);
        else canvas.drawImage(full.image, 0, 0, paint);
      } else {
        canvas.scale(factor, factor);
        for (const [b, x, y, scale, transform] of next.slice(0, -1)) {
          let image = images.get(b);
          if (!image) {
            image = CK.MakeImage({ width: b.width, height: b.height,
              alphaType: b.format === 1 ? CK.AlphaType.Opaque : CK.AlphaType.Premul,
              colorType: CK.ColorType.BGRA_8888, colorSpace: CK.ColorSpace.SRGB }, b.bytes, b.stride);
            if (!image) throw Error('Cannot allocate surface image');
            images.set(b, image);
          }
          canvas.save();
          try {
            const rotation = transform & 3, flip = transform & 4;
            const w = rotation % 2 ? b.height : b.width, h = rotation % 2 ? b.width : b.height;
            canvas.translate(x, y); canvas.scale(1 / scale, 1 / scale);
            if (flip) { canvas.translate(w, 0); canvas.scale(-1, 1); }
            if (rotation === 1) { canvas.translate(0, b.width); canvas.rotate(-90, 0, 0); }
            if (rotation === 2) { canvas.translate(b.width, b.height); canvas.rotate(180, 0, 0); }
            if (rotation === 3) { canvas.translate(b.height, 0); canvas.rotate(90, 0, 0); }
            if (smooth && factor / scale < 1) canvas.drawImageOptions(image, 0, 0, CK.FilterMode.Linear, CK.MipmapMode.None, paint);
            else canvas.drawImage(image, 0, 0, paint);
          } finally { canvas.restore(); }
        }
        if (pointer) {
          paint.setColor(CK.Color(255,255,255,1));
          canvas.drawRect(CK.XYWHRect(compositor.input.x,compositor.input.y,3,15),paint);
          canvas.drawRect(CK.XYWHRect(compositor.input.x,compositor.input.y,10,3),paint);
        }
      }
    } finally { canvas.restore(); }
    view.target.flush(); view.image = view.target.makeImageSnapshot();
    if (!view.image) throw Error('Cannot snapshot software surface');
    view.scene = next;
    return view.image;
  }
  return {
    close() {
      if (closed) return; closed = true;
      release(preview); release(full); preview = full = null;
      for (const image of images.values()) image.delete(); images.clear(); paint.delete();
    },
    async screenshot({ format = 'png', quality = 80, viewport, maxWidth, maxHeight } = {}) {
      if (closed) throw Error('Renderer is closed');
      const width = viewport?.width ?? compositor.width, height = viewport?.height ?? compositor.height;
      if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 8192) || width * height > 16777216) throw Error('Invalid capture size');
      if ([maxWidth, maxHeight].some(v => v !== undefined && (!Number.isFinite(v) || v <= 0))) throw Error('Invalid capture limit');
      const deviceScale = viewport?.deviceScaleFactor ?? compositor.deviceScaleFactor ?? 1;
      if (!Number.isFinite(deviceScale) || deviceScale <= 0 || deviceScale > 8) throw Error('Invalid device scale');
      const factor = Math.min(deviceScale, (maxWidth || width * deviceScale) / width, (maxHeight || height * deviceScale) / height);
      const outWidth = Math.max(1, Math.floor(width * factor)), outHeight = Math.max(1, Math.floor(height * factor));
      if (outWidth > 8192 || outHeight > 8192 || outWidth * outHeight > 16777216) throw Error('Invalid output size');
      const measure = compositor.measure, started = measure ? performance.now() : 0;
      const label = `${format}:${outWidth}x${outHeight}`;
      try {
        const image = compose(width, height, factor, outWidth, outHeight, factor === deviceScale, deviceScale < 1);
        measure?.(`${label}:compose`, performance.now() - started);
        const encodeStarted = measure ? performance.now() : 0;
        if (format === 'png') {
          const result = Buffer.from(image.encodeToBytes(CK.ImageFormat.PNG,100)).toString('base64');
          measure?.(`${label}:encode+base64`,performance.now()-encodeStarted); return result;
        }
        const info = {width:image.width(),height:image.height(),colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB};
        // Copy out before awaiting: another capture or close may replace cached images.
        const pixels = image.readPixels(0,0,info);
        measure?.(`${label}:readback`,performance.now()-encodeStarted);
        const conversionStarted = measure ? performance.now() : 0;
        const result = Buffer.from(await encodeImage(pixels,info.width,info.height,{format,quality})).toString('base64');
        measure?.(`${label}:bmp+encode+base64`,performance.now()-conversionStarted); return result;
      } finally { measure?.(`${label}:total`,performance.now()-started); }
    },
  };
}

import {RawFrames} from './raw-frames.js';
import {createDirectComposer} from './direct-compositor.js';
import {encodePng} from './png-fast.js';
import { surfaceViewport } from './viewport.js';
import { encodeImage, rgbaBitmap } from './frame.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
export async function createRenderer(compositor, { canvasKit, directComposition = true, rawFrames = new RawFrames() } = {}) {
  const CK = canvasKit ?? await CanvasKitInit({ wasmBinary: await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm', import.meta.url)).arrayBuffer() });
  // SHM snapshots are immutable: each applied buffer commit replaces pixels.
  // Cache one-dimensional CanvasKit sampling maps, never client image pixels.
  // This preserves its nearest-neighbour boundary rounding without repainting
  // a full frame. Only geometry changes create strips; normal frames reuse them.
  const sampleMaps = new Map();
  function sampleMap(length, factor, origin, limit, vertical) {
    const key = [length, factor, origin, limit, vertical].join(':');
    if (sampleMaps.has(key)) return sampleMaps.get(key);
    const source = new Uint32Array(length);
    for (let i = 0; i < length; i++) source[i] = 0xff000000 | i;
    const width = vertical ? 1 : length, height = vertical ? length : 1;
    const image = CK.MakeImage({width,height,colorType:CK.ColorType.RGBA_8888,
      alphaType:CK.AlphaType.Premul,colorSpace:CK.ColorSpace.SRGB},new Uint8Array(source.buffer),width*4);
    const target = CK.MakeSurface(vertical ? 1 : limit, vertical ? limit : 1);
    let snapshot;
    try {
      const canvas = target.getCanvas();
      canvas.clear(CK.TRANSPARENT);
      canvas.scale(factor,factor);
      canvas.translate(vertical ? 0 : origin/factor,vertical ? origin/factor : 0);
      canvas.drawImage(image,0,0,paint);
      target.flush(); snapshot=target.makeImageSnapshot();
      const bytes=snapshot.readPixels(0,0,{width:vertical?1:limit,height:vertical?limit:1,
        colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB});
      const map=new Int32Array(limit);
      for(let i=0;i<limit;i++)map[i]=bytes[i*4]|(bytes[i*4+1]<<8)|(bytes[i*4+2]<<16);
      if(sampleMaps.size>=128)sampleMaps.delete(sampleMaps.keys().next().value);
      sampleMaps.set(key,map);
      return map;
    } finally { snapshot?.delete(); target?.dispose(); image?.delete(); }
  }
  let cursorTile;
  function rasterCursor(surface, x, y, w, h, factor, outputWidth, outputHeight, clipX, clipY) {
    const b=surface.pixels, v=surfaceViewport(surface);
    // Keep transformed/cropped and unusually large client cursors on the
    // existing full compositor path. Bound overlay size independently of clients.
    if (surface.transform!==0 || ![0,1].includes(b.format) ||
        ![x,y,w,h].every(Number.isFinite) || w<=0 || h<=0 ||
        v.source.some((n,i)=>n!==[0,0,b.width/surface.scale,b.height/surface.scale][i])) return null;
    const left=Math.max(0,Math.floor(x)),top=Math.max(0,Math.floor(y)),width=Math.min(outputWidth,Math.ceil(x+w))-left,height=Math.min(outputHeight,Math.ceil(y+h))-top;
    if(width<=0 || height<=0 || width>512 || height>512) return null;
    const key=[b,x,y,w,h,width,height,factor,outputWidth,outputHeight,clipX,clipY];
    if(cursorTile && key.every((n,i)=>n===cursorTile.key[i]))
      return {pixels:cursorTile.pixels,x:left,y:top};
    const target=CK.MakeSurface(outputWidth,outputHeight);
    if(!target) return null;
    let image,snapshot;
    try {
      image=CK.MakeImage({width:b.width,height:b.height,colorType:CK.ColorType.BGRA_8888,
        alphaType:b.format===1?CK.AlphaType.Opaque:CK.AlphaType.Premul,colorSpace:CK.ColorSpace.SRGB},b.bytes,b.stride);
      if(!image)return null;
      const canvas=target.getCanvas();canvas.clear(CK.TRANSPARENT);
      // Preserve the full compositor's transform (including floating-point
      // sampling boundaries); rasterize only the cursor and read its bounds.
      canvas.scale(factor,factor);canvas.translate(-clipX,-clipY);
      canvas.translate(compositor.input.x-compositor.input.cursor.x,compositor.input.y-compositor.input.cursor.y);
      if(v.width!==v.source[2] || v.height!==v.source[3])canvas.scale(v.width/v.source[2],v.height/v.source[3]);
      canvas.scale(1/surface.scale,1/surface.scale);
      if(factor<1 && (w/b.width<1-1e-6 || h/b.height<1-1e-6))
        canvas.drawImageOptions(image,0,0,CK.FilterMode.Linear,CK.MipmapMode.None,paint);
      else canvas.drawImage(image,0,0,paint);
      target.flush();snapshot=target.makeImageSnapshot();
      const bytes=snapshot?.readPixels(left,top,{width,height,colorType:CK.ColorType.RGBA_8888,
        alphaType:CK.AlphaType.Premul,colorSpace:CK.ColorSpace.SRGB});
      if(!bytes)return null;
      // CanvasKit exposes RGBA readback; convert only the tiny cursor tile.
      for(let i=0;i<bytes.length;i+=4){const r=bytes[i];bytes[i]=bytes[i+2];bytes[i+2]=r;}
      const pixels={bytes,width,height,stride:width*4,format:0};
      cursorTile={key,pixels};return {pixels,x:left,y:top};
    } finally {snapshot?.delete();image?.delete();target.dispose();}
  }
  const direct = createDirectComposer(compositor, sampleMap, rasterCursor);
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
  function compose(width, height, factor, outWidth, outHeight, isFull, smooth, clipX=0, clipY=0) {
    const cursor = compositor.input.cursor;
    const surfaces = [...compositor.wm.renderSurfaces()];
    if (cursor?.surface?.pixels) surfaces.push(cursor.surface);
    // Include geometry, ordering and cursor state, not only buffer commits.
    const next = surfaces.filter(s => s.pixels).map(s => {
      const origin = s === cursor?.surface ? { x: compositor.input.x - cursor.x, y: compositor.input.y - cursor.y } : compositor.wm.origin(s);
      const viewport = surfaceViewport(s);
      return [s.pixels, origin.x, origin.y, s.scale, s.transform, ...viewport.source, viewport.width, viewport.height, !!s.fractionalScale];
    });
    const pointer = !cursor && compositor.input.pointer;
    next.push(pointer ? ['pointer', compositor.input.x, compositor.input.y,clipX,clipY] : ['no-pointer',clipX,clipY]);
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
        canvas.translate(-clipX,-clipY);
        for (let [b, x, y, scale, transform, sx, sy, sw, sh, dw, dh, fractional] of next.slice(0, -1)) {
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
            // Fractional clients round their buffers to physical pixels. Match
            // that rounding when it gives a 1:1 mapping, avoiding a second filter.
            if(fractional && scale===1 && sx===0 && sy===0 && sw===w && sh===h && Math.round(dw*factor)===w && Math.round(dh*factor)===h){
              x=Math.round(x*factor)/factor;y=Math.round(y*factor)/factor;
              dw=w/factor;dh=h/factor;
            }
            canvas.translate(x, y);
            if(sx!==0 || sy!==0 || sw!==w/scale || sh!==h/scale)
              canvas.clipRect(CK.XYWHRect(0,0,dw,dh),CK.ClipOp.Intersect,false);
            if(dw!==sw || dh!==sh)canvas.scale(dw / sw, dh / sh);
            if(sx!==0 || sy!==0)canvas.translate(-sx,-sy);
            canvas.scale(1 / scale, 1 / scale);
            if (flip) { canvas.translate(w, 0); canvas.scale(-1, 1); }
            if (rotation === 1) { canvas.translate(0, b.width); canvas.rotate(-90, 0, 0); }
            if (rotation === 2) { canvas.translate(b.width, b.height); canvas.rotate(180, 0, 0); }
            if (rotation === 3) { canvas.translate(b.height, 0); canvas.rotate(90, 0, 0); }
            if (smooth && (factor * dw / sw / scale < 1-1e-6 || factor * dh / sh / scale < 1-1e-6)) canvas.drawImageOptions(image, 0, 0, CK.FilterMode.Linear, CK.MipmapMode.None, paint);
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
      direct.close(); sampleMaps.clear(); cursorTile=null;
      rawFrames.close();
      release(preview); release(full); preview = full = null;
      for (const image of images.values()) image.delete(); images.clear(); paint.delete();
    },
    async screenshot({ format = 'png', quality = 80, viewport, maxWidth, maxHeight, clip } = {}) {
      if (closed) throw Error('Renderer is closed');
      const width = viewport?.width ?? compositor.width, height = viewport?.height ?? compositor.height;
      if (![width, height].every(v => Number.isInteger(v) && v > 0 && v <= 8192) || width * height > 16777216) throw Error('Invalid capture size');
      if ([maxWidth, maxHeight].some(v => v !== undefined && (!Number.isFinite(v) || v <= 0))) throw Error('Invalid capture limit');
      const deviceScale = viewport?.deviceScaleFactor ?? compositor.deviceScaleFactor ?? 1;
      if (!Number.isFinite(deviceScale) || deviceScale <= 0 || deviceScale > 8) throw Error('Invalid device scale');
      if(clip && (![clip.x,clip.y,clip.width,clip.height,clip.scale].every(Number.isFinite) || clip.width<=0 || clip.height<=0 || clip.scale<=0 || clip.scale>8))throw Error('Invalid screenshot clip');
      const captureWidth=clip?.width ?? width, captureHeight=clip?.height ?? height;
      // A supplied clip takes precedence over fallback screencast max limits.
      // Preserve native pixel density: crop, never resize to fit those limits.
      const factor = clip ? deviceScale*clip.scale : Math.min(deviceScale, maxWidth ? maxWidth / captureWidth : Infinity, maxHeight ? maxHeight / captureHeight : Infinity);
      const outWidth = Math.max(1, (clip ? Math.round(captureWidth * factor) : Math.floor(width * factor))), outHeight = Math.max(1, (clip ? Math.round(captureHeight * factor) : Math.floor(height * factor)));
      if (outWidth > 8192 || outHeight > 8192 || outWidth * outHeight > 16777216) throw Error('Invalid output size');
      const measure = compositor.measure, started = measure ? performance.now() : 0;
      const label = `${format}:${outWidth}x${outHeight}`;
      try {
        const pixels = directComposition && factor === deviceScale &&
          ((format === 'rgba' || format === 'bgra') || typeof Bun.Image === 'function' || (format === 'png' && compositor.fastPng))
          ? direct.compose(outWidth, outHeight, factor,clip?.x ?? 0,clip?.y ?? 0) : null;
        if (pixels) {
          measure?.(`${label}:direct-compose`, performance.now() - started);
          const encodeStarted = measure ? performance.now() : 0;
          // Private raw file formats, explicitly negotiated by a cooperating client.
          // Standard screenshot formats and their responses remain unchanged.
          if (format === 'rgba' || format === 'bgra') {
            const rgba = format === 'bgra' ? pixels : new Uint32Array(pixels.length);
            for (let i = 0; format === 'rgba' && i < pixels.length; i++) {
              const p = pixels[i];
              rgba[i] = (p & 0xff00ff00) | ((p & 255) << 16) | ((p >>> 16) & 255);
            }
            measure?.(`${label}:raw-convert`, performance.now() - encodeStarted);
            const writeStarted = measure ? performance.now() : 0;
            const result = rawFrames.write(Buffer.from(rgba.buffer), outWidth, outHeight, format);
            measure?.(`${label}:raw-file-write`, performance.now() - writeStarted);
            return result;
          }
          let bytes;
          if (format === 'png' && compositor.fastPng) bytes = encodePng(pixels, outWidth, outHeight, true, true);
          else {
            // One BMP wrapper copy; BGRA masks avoid a channel-conversion pass.
            const bitmap = rgbaBitmap(new Uint8Array(pixels.buffer), outWidth, outHeight);
            const header = new DataView(bitmap.buffer);
            header.setUint32(54, 0x00ff0000, true); header.setUint32(62, 0x000000ff, true);
            const image = new Bun.Image(bitmap);
            const kind = ['png', 'jpeg', 'webp'].includes(format) ? format : 'png';
            const level = Math.min(100, Math.max(0, Number.isFinite(quality) ? quality : 80));
            bytes = await (kind === 'png' ? image.png().bytes() : image[kind]({quality: level}).bytes());
          }
          const result = Buffer.from(bytes).toString('base64');
          measure?.(`${label}:direct-encode`, performance.now() - encodeStarted);
          return result;
        }
        const image = compose(captureWidth, captureHeight, factor, outWidth, outHeight, factor === deviceScale, deviceScale < 1,clip?.x ?? 0,clip?.y ?? 0);
        measure?.(`${label}:compose`, performance.now() - started);
        const encodeStarted = measure ? performance.now() : 0;
        if (format === 'png' && !compositor.fastPng) {
          const result = Buffer.from(image.encodeToBytes(CK.ImageFormat.PNG,100)).toString('base64');
          measure?.(`${label}:encode+base64`,performance.now()-encodeStarted); return result;
        }
        const info = {width:image.width(),height:image.height(),colorType:format === 'bgra' ? CK.ColorType.BGRA_8888 : CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB};
        // Copy out before awaiting: another capture or close may replace cached images.
        const rgba = format === 'bgra' ? (()=>{
          const memory=CK.Malloc(Uint8Array,info.width*info.height*4);
          try {
            if(!image.readPixels(0,0,info,memory,info.width*4))throw Error('BGRA readback failed');
            return memory.toTypedArray().slice();
          }finally{CK.Free(memory);}
        })() : image.readPixels(0,0,info);
        measure?.(`${label}:readback`,performance.now()-encodeStarted);
        const conversionStarted = measure ? performance.now() : 0;
        if (format === 'rgba' || format === 'bgra') {
          if (!rgba) throw Error('Cannot read raw screenshot pixels');
          const result = rawFrames.write(Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength), outWidth, outHeight, format);
          measure?.(`${label}:raw-file-write`, performance.now() - conversionStarted);
          return result;
        }
        const result = Buffer.from(format === 'png' && compositor.fastPng
          ? encodePng(new Uint32Array(rgba.buffer, rgba.byteOffset, rgba.byteLength / 4), info.width, info.height, false)
          : await encodeImage(rgba,info.width,info.height,{format,quality})).toString('base64');
        measure?.(`${label}:bmp+encode+base64`,performance.now()-conversionStarted); return result;
      } finally { measure?.(`${label}:total`,performance.now()-started); }
    },
  };
}

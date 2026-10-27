import {surfaceViewport} from './viewport.js';
import {RawFrames} from './raw-frames.js';

// Raw captures can consume a covering, immutable client snapshot directly.
// Keep decorated, cropped, scaled and translucent scenes on the normal renderer.
export function createFullFramePresenter(compositor, createRenderer) {
  const files=new RawFrames(), opacity=new WeakMap();
  let renderer, closed=false;
  return {
    close(){closed=true;files.close();renderer?.then(r=>r.close(),()=>{});},
    async screenshot(options={}) {
      if(closed || options.format!=='bgra' || options.maxWidth!==undefined || options.maxHeight!==undefined)return null;
      const width=options.viewport?.width??compositor.width,height=options.viewport?.height??compositor.height;
      const factor=options.viewport?.deviceScaleFactor??compositor.deviceScaleFactor??1,c=options.clip;
      if(![width,height].every(n=>Number.isInteger(n)&&n>0&&n<=8192)||width*height>16777216 ||
          !Number.isFinite(factor)||factor<=0 || factor>8 || c&&(c.x!==0||c.y!==0||c.scale!==1||!Number.isFinite(c.width)||!Number.isFinite(c.height)||c.width<=0||c.height<=0))return null;
      const w=c?Math.round(c.width*factor):Math.floor(width*factor),h=c?Math.round(c.height*factor):Math.floor(height*factor);
      if(w<1||h<1||w>8192||h>8192||w*h>16777216)return null;
      const s=[...compositor.wm.renderSurfaces()].filter(s=>s.pixels).at(-1);
      if(!s||s.transform!==0||s.scale!==1)return null;
      const b=s.pixels,v=surfaceViewport(s),p=compositor.wm.origin(s);
      if(p.x!==0||p.y!==0||![0,1].includes(b.format)||b.width!==w||!Number.isInteger(b.height)||b.height<h||b.stride!==w*4||
          v.source.some((n,i)=>n!==[0,0,b.width,b.height][i]) ||
          !(s.fractionalScale ? Math.round(v.width*factor)===b.width&&Math.round(v.height*factor)===b.height : v.width*factor===b.width&&v.height*factor===b.height))return null;
      const started=performance.now(),bytes=b.bytes;
      if(bytes.byteLength<b.stride*b.height)return null;
      let opaque=opacity.get(b);
      if(opaque===undefined){opaque=true;for(let i=3;i<bytes.byteLength;i+=4)if(bytes[i]!==255){opaque=false;break;}opacity.set(b,opaque);}
      if(!opaque)return null;
      compositor.measure?.('full-frame:read-validate',performance.now()-started);
      const input=compositor.input;
      if(input.cursor?.surface?.pixels || !input.cursor&&input.pointer) {
        // The direct composer copies the covering surface once and blends the
        // cursor only. Keep the complete scene for conservative renderer fallback.
        renderer??=Promise.resolve(createRenderer(compositor));
        const r=await renderer;
        if(closed)throw Error('Renderer is closed');
        return r.screenshot(options);
      }
      const write=performance.now();
      const result=files.write(Buffer.from(bytes.buffer,bytes.byteOffset,w*h*4),w,h,'bgra');
      compositor.measure?.('full-frame:write',performance.now()-write);
      return result;
    }
  };
}

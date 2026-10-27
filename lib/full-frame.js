import {readFileSync,unlinkSync} from 'node:fs';
import {snapshotOpaque} from './snapshot.js';
import {surfaceViewport} from './viewport.js';
import {RawFrames} from './raw-frames.js';

// Raw captures can consume a covering, immutable client snapshot directly.
// Keep decorated, cropped, scaled and translucent scenes on the normal renderer.
export function createFullFramePresenter(compositor, createRenderer) {
  const files=new RawFrames();
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
      if(!snapshotOpaque(b,bytes))return null;
      compositor.measure?.('full-frame:read-validate',performance.now()-started);
      const input=compositor.input;
      let patch;
      if(input.cursor?.surface?.pixels || !input.cursor&&input.pointer) {
        // Render only the cursor rectangle, then patch it into the exported file.
        // Keep the complete scene available for conservative renderer fallback.
        renderer??=Promise.resolve(createRenderer(compositor));
        const r=await renderer;
        if(closed)throw Error('Renderer is closed');
        if(!input.cursor)return r.screenshot(options);
        const cursor=input.cursor,view=cursor?.surface?.pixels?surfaceViewport(cursor.surface):null;
        const left=(input.x-(cursor?.x??0))*factor,top=(input.y-(cursor?.y??0))*factor;
        const right=left+(view?.width??10)*factor,bottom=top+(view?.height??15)*factor;
        if(![left,top,right,bottom].every(Number.isFinite))return r.screenshot(options);
        // Include the filter fringe and align the small capture to output pixels.
        const x=Math.max(0,Math.floor(left)-2),y=Math.max(0,Math.floor(top)-2);
        const rw=Math.min(w,Math.ceil(right)+2)-x,rh=Math.min(h,Math.ceil(bottom)+2)-y;
        if(rw>0&&rh>0){
          if(rw*rh>w*h/4)return r.screenshot(options);
          const tile=JSON.parse(await r.screenshot({...options,clip:{x:x/factor,y:y/factor,width:rw/factor,height:rh/factor,scale:1}}));
          try{patch={x,y,width:rw,height:rh,bytes:readFileSync(tile.path)};}finally{unlinkSync(tile.path);}
          if(patch.bytes.length!==rw*rh*4)throw Error('Invalid cursor patch');
        }
      }
      const write=performance.now();
      const result=files.write(Buffer.from(bytes.buffer,bytes.byteOffset,w*h*4),w,h,'bgra',patch);
      compositor.measure?.('full-frame:write',performance.now()-write);
      return result;
    }
  };
}

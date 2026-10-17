import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
import {createRenderer} from '../lib/renderer.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';

test('zoom captures physical pixels and filters reduced image content',async()=>{
 const CK=await CanvasKitInit({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()});
 const bytes=Buffer.alloc(8*8*4);for(let y=0;y<8;y++)for(let x=0;x<8;x++){const i=(y*8+x)*4,c=(x+y)%2?255:0;bytes.set([c,c,c,255],i);}
 const surface={pixels:{bytes,width:8,height:8,stride:32,format:1},scale:1,transform:0};
 const comp={width:8,height:8,input:{},wm:{renderSurfaces:()=>[surface],origin:()=>({x:0,y:0})}};
 const renderer=await createRenderer(comp,{canvasKit:CK});
 async function capture(scale,limits={}){
  const png=await renderer.screenshot({viewport:{width:8,height:8,deviceScaleFactor:scale},...limits});const image=CK.MakeImageFromEncoded(Buffer.from(png,'base64'));
  try{return {width:image.width(),height:image.height(),pixels:image.readPixels(0,0,{width:image.width(),height:image.height(),colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB})};}finally{image.delete();}
 }
 try{
  expect((await capture(1)).width).toBe(8);
  const small=await capture(.5);expect(small.width).toBe(4);expect(small.height).toBe(4);
  // Nearest-neighbor would discard alternate strokes; linear sampling averages them.
  for(let i=0;i<small.pixels.length;i+=4){expect(small.pixels[i]).toBeGreaterThanOrEqual(127);expect(small.pixels[i]).toBeLessThanOrEqual(128);}
  expect((await capture(2)).width).toBe(16);
  expect((await capture(.5,{maxWidth:2,maxHeight:2})).width).toBe(2);
  expect((await capture(.5)).pixels).toEqual(small.pixels);
  comp.deviceScaleFactor=.5;
  const img=CK.MakeImageFromEncoded(Buffer.from(await renderer.screenshot(),'base64'));expect(img.width()).toBe(4);img.delete();
  await expect(capture(Infinity)).rejects.toThrow('device scale');
 }finally{renderer.close();}
});

test('CDP device metrics preserve logical input space and return physical screenshot dimensions',async()=>{
 const previous=process.env.XDG_RUNTIME_DIR;process.env.XDG_RUNTIME_DIR=mkdtempSync(join(tmpdir(),'buninu-zoom-'));
 const app=await start(['--remote-debugging-port=0']);let ws;
 try{
  ws=new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0;const pending=new Map();ws.onmessage=({data})=>{const m=JSON.parse(data);const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
  const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  for(const zoom of [.5,.75,1,2]){
   const width=Math.round(320/zoom),height=Math.round(240/zoom);
   await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:zoom,mobile:false},sessionId);
   expect(app.compositor.width).toBe(width);expect(app.compositor.height).toBe(height);
   const {data}=await call('Page.captureScreenshot',{format:'png'},sessionId),meta=await new Bun.Image(Buffer.from(data,'base64')).metadata();
   expect(meta.width).toBe(Math.floor(width*zoom));expect(meta.height).toBe(Math.floor(height*zoom));
  }
 }finally{ws?.close();app.close();if(previous===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=previous;}
},15000);

// bun bench/wallpaper.js [image] [rounds]
// Experiment only: compare cover-resize preparation into opaque BGRA pixels.
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
const file=process.argv[2]??fileURLToPath(new URL('../wallpaper.jpg',import.meta.url));
const rounds=Number(process.argv[3]??9);
assert.ok(Number.isInteger(rounds)&&rounds>0&&rounds<=100);
const source=await Bun.file(file).bytes();
const metadata=await new Bun.Image(source).metadata();
const now=()=>performance.now();
const paeth=(a,b,c)=>{const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;};
// Deliberately limited to the non-interlaced RGBA8 PNG emitted by Bun.Image.
// A production decoder would also need strict input/resource limits and CRCs.
function decode(png,w,h){
 const v=new DataView(png.buffer,png.byteOffset,png.byteLength),parts=[];
 assert.equal(v.getUint32(16),w);assert.equal(v.getUint32(20),h);
 assert.equal(png[24],8);assert.equal(png[25],6);assert.equal(png[28],0);
 for(let p=8;p<png.length;){const size=v.getUint32(p),type=v.getUint32(p+4);if(type===0x49444154)parts.push(png.subarray(p+8,p+8+size));p+=size+12;}
 const raw=Bun.inflateSync(Buffer.concat(parts).subarray(2,-4)),stride=w*4;
 assert.equal(raw.length,(stride+1)*h);
 const pixels=new Uint8Array(w*h*4);
 for(let y=0;y<h;y++){
  const from=y*(stride+1),row=y*stride,filter=raw[from];
  assert.ok(filter<=4);
  const start=from+1;
  if(filter===0){pixels.set(raw.subarray(start,start+stride),row);continue;}
  if(filter===1){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+(x>=4?pixels[row+x-4]:0);}
  else if(filter===2){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+(y?pixels[row+x-stride]:0);}
  else if(filter===3){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+(((x>=4?pixels[row+x-4]:0)+(y?pixels[row+x-stride]:0))>>1);}
  else{for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+paeth(x>=4?pixels[row+x-4]:0,y?pixels[row+x-stride]:0,y&&x>=4?pixels[row+x-stride-4]:0);}

 }
 return pixels;
}
function cropBgra(rgba,sw,sh,w,h){
 const out=new Uint8Array(w*h*4),words=new Uint32Array(out.buffer),input=new Uint32Array(rgba.buffer,rgba.byteOffset,rgba.byteLength/4),x0=Math.floor((sw-w)/2),y0=Math.floor((sh-h)/2);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const at=(y+y0)*sw+x+x0,word=input[at];if((word>>>24)===255){words[y*w+x]=(word&0xff00ff00)|((word&255)<<16)|((word>>>16)&255);continue;}
  const s=at*4,d=(y*w+x)*4,a=rgba[s+3]/255;
  out[d]=Math.round(rgba[s+2]*a+34*(1-a));out[d+1]=Math.round(rgba[s+1]*a+27*(1-a));out[d+2]=Math.round(rgba[s]*a+24*(1-a));out[d+3]=255;
 }
 return out;
}
let CK,decoded,paint;
const initStart=now();
CK=await CanvasKitInit({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()});
const initMs=now()-initStart;
const decodeStart=now();decoded=CK.MakeImageFromEncoded(source);assert.ok(decoded);paint=new CK.Paint();const sourceDecodeMs=now()-decodeStart;
async function bunPath(w,h,compressionLevel,filter){
 const begin=now(),ratio=Math.max(w/metadata.width,h/metadata.height),sw=Math.ceil(metadata.width*ratio),sh=Math.ceil(metadata.height*ratio);
 const png=await new Bun.Image(source).resize(sw,sh,{filter}).png({compressionLevel}).bytes(),encoded=now();
 const rgba=decode(png,sw,sh),unpacked=now();
 const pixels=cropBgra(rgba,sw,sh,w,h),end=now();
 return {pixels,total:end-begin,resizeEncode:encoded-begin,decode:unpacked-encoded,crop:end-unpacked,pngBytes:png.length};
}
function cvkPath(w,h){
 const begin=now(),surface=CK.MakeSurface(w,h);assert.ok(surface);let snapshot;
 try{
  const canvas=surface.getCanvas(),ratio=Math.max(w/metadata.width,h/metadata.height),sw=metadata.width*ratio,sh=metadata.height*ratio;
  canvas.clear(CK.Color(24,27,34,1));
  canvas.drawImageRectOptions(decoded,CK.XYWHRect(0,0,metadata.width,metadata.height),CK.XYWHRect((w-sw)/2,(h-sh)/2,sw,sh),CK.FilterMode.Linear,CK.MipmapMode.None,paint);
  surface.flush();snapshot=surface.makeImageSnapshot();const drawn=now();
  const memory=CK.Malloc(Uint8Array,w*h*4);let pixels;try{assert.ok(snapshot.readPixels(0,0,{width:w,height:h,colorType:CK.ColorType.BGRA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB},memory,w*4));pixels=memory.toTypedArray().slice();}finally{CK.Free(memory);}
  return {pixels,total:now()-begin,draw:drawn-begin,readback:now()-drawn};
 }finally{snapshot?.delete();surface.dispose();}
}
const modes={bunDefault:(w,h)=>bunPath(w,h,6,'lanczos3'),bunFast:(w,h)=>bunPath(w,h,0,'lanczos3'),bunLinear:(w,h)=>bunPath(w,h,0,'bilinear'),cvk:cvkPath};
if(process.env.BENCH_MODES)for(const name of Object.keys(modes))if(!process.env.BENCH_MODES.split(',').includes(name))delete modes[name];
assert.ok(Object.keys(modes).length);
const report={bun:Bun.version,file,metadata,rounds,cvkInitMs:initMs,cvkSourceDecodeMs:sourceDecodeMs,results:[]};
try{
 // Verify the JS decoder exactly matches CanvasKit for the same PNG bytes.
 const png=await new Bun.Image(source).resize(37,29).png({compressionLevel:0}).bytes();
 const check=CK.MakeImageFromEncoded(png);
 try{assert.deepEqual(decode(png,37,29),check.readPixels(0,0,{width:37,height:29,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB}));}finally{check.delete();}
 for(const [w,h]of [[800,600],[1280,720],[1920,1080],[1080,1920]]){
  const samples=Object.fromEntries(Object.keys(modes).map(k=>[k,[]]));
  for(let i=0;i<rounds+1;i++){
   const names=Object.keys(modes);if(i%2)names.reverse();
   for(const name of names){const r=await modes[name](w,h);assert.equal(r.pixels.length,w*h*4);if(i) samples[name].push({...r,pixels:undefined});else console.log('first',w,h,name,r.total.toFixed(2));}
  }
  const row={width:w,height:h,modes:{}};
  for(const [name,values]of Object.entries(samples)){
   const sorted=values.map(v=>v.total).sort((a,b)=>a-b),mean={};
   for(const key of Object.keys(values[0]))if(key!=='pixels')mean[key]=values.reduce((a,v)=>a+v[key],0)/values.length;
   row.modes[name]={mean,p50:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))]};
  }
  report.results.push(row);console.log(JSON.stringify(row));
 }
 await Bun.write(process.env.BENCH_OUTPUT??'/tmp/wallpaper-benchmark.json',JSON.stringify(report,null,2));
 console.log('CVK initialization',initMs,'source decode',sourceDecodeMs,'ms; results',process.env.BENCH_OUTPUT??'/tmp/wallpaper-benchmark.json');
}finally{decoded.delete();paint.delete();}

import {test,expect} from 'bun:test';
import {createFullFramePresenter} from '../lib/full-frame.js';
import {createRenderer} from '../lib/renderer.js';
import {unlinkSync,existsSync} from 'node:fs';
test('full raw frame preserves bytes, cursor overlays, validation and cleanup',async()=>{
 const storage=Buffer.alloc(4+8*8*4,255),pixels={bytes:storage.subarray(4),width:8,height:8,stride:32,format:0};
 for(let i=0;i<pixels.bytes.length;i+=4){pixels.bytes[i]=i%251;pixels.bytes[i+1]=70;pixels.bytes[i+2]=120;}
 const s={pixels,scale:1,transform:0},comp={width:8,height:7,input:{},wm:{renderSurfaces:()=>[s],origin:()=>({x:0,y:0})}};
 const fast=createFullFramePresenter(comp,createRenderer),ref=await createRenderer(comp);let path;
 try{
  for(const input of [{},{pointer:true,x:2,y:3},{}]){
   comp.input=input;const a=JSON.parse(await fast.screenshot({format:'bgra'})),b=JSON.parse(await ref.screenshot({format:'bgra'}));
   expect(await Bun.file(a.path).bytes()).toEqual(await Bun.file(b.path).bytes());unlinkSync(b.path);path=a.path;
  }
  for(const o of [{format:'png'},{format:'bgra',maxWidth:0},{format:'bgra',viewport:{deviceScaleFactor:9}},{format:'bgra',clip:{x:1,y:0,width:7,height:7,scale:1}}])expect(await fast.screenshot(o)).toBeNull();
  s.pixels={...pixels,bytes:Buffer.from(pixels.bytes)};s.pixels.bytes[3]=0;
  expect(await fast.screenshot({format:'bgra'})).toBeNull();
 }finally{fast.close();ref.close();}
 expect(existsSync(path)).toBe(false);
});

import {createWorkerRenderer} from '../lib/worker-renderer.js';
test('worker bypass remains identical and releases its raw frame directory',async()=>{
 const s={scale:1,transform:0,pixels:{bytes:Buffer.alloc(64,255),width:4,height:4,stride:16,format:0}};
 const labels=[],comp={width:4,height:4,input:{},measure:k=>labels.push(k),wm:{renderSurfaces:()=>[s],origin:()=>({x:0,y:0})}};
 const fast=await createWorkerRenderer(comp),normal=await createWorkerRenderer(comp,{directScanout:false});let file;
 try{
  const a=JSON.parse(await fast.screenshot({format:'bgra'}));file=a.path;
  expect(labels).toContain('full-frame:write');expect(labels.some(k=>k.startsWith('worker:'))).toBe(false);
  const b=JSON.parse(await normal.screenshot({format:'bgra'}));expect(await Bun.file(file).bytes()).toEqual(await Bun.file(b.path).bytes());
 }finally{fast.close();normal.close();}
 expect(existsSync(file)).toBe(false);
});

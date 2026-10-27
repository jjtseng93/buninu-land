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

import {snapshotOpaque} from '../lib/snapshot.js';
test('shared snapshot opacity ignores padding and supports unaligned byte views', () => {
 for(const offset of [0,1,4]){
  const bytes=new Uint8Array(40+offset).subarray(offset),width=3,height=2,stride=20;
  for(let row=0;row<height;row++)for(let x=0;x<width;x++)bytes[row*stride+x*4+3]=255;
  expect(snapshotOpaque({bytes,width,height,stride})).toBe(true);
  for(let row=0;row<height;row++)for(let x=0;x<width;x++){
   const i=row*stride+x*4+3;bytes[i]=254;
   expect(snapshotOpaque({bytes,width,height,stride})).toBe(false);bytes[i]=255;
  }
 }
});

test('small cursor patches match full composition at fractional scale and edges',async()=>{
 const bytes=Buffer.alloc(224*224*4,255);for(let i=0;i<bytes.length;i+=4){bytes[i]=i%251;bytes[i+1]=90;bytes[i+2]=40;}
 const s={scale:1,transform:0,fractionalScale:true,viewportDestination:[128,128],pixels:{bytes,width:224,height:224,stride:896,format:0}};
 const comp={width:128,height:128,deviceScaleFactor:1.75,input:{},wm:{renderSurfaces:()=>[s],origin:()=>({x:0,y:0})}};
 const fast=createFullFramePresenter(comp,createRenderer),ref=await createRenderer(comp);
 const cursor={scale:1,transform:0,pixels:{bytes:Buffer.alloc(24*24*4,90),width:24,height:24,stride:96,format:0}};
 try{for(const pos of [[20,30],[-3,-4],[125,126],[300,300]])for(const real of [false,true]){
   comp.input={x:pos[0],y:pos[1],...(real?{cursor:{surface:cursor,x:2,y:3}}:{pointer:true})};
   const a=JSON.parse(await fast.screenshot({format:'bgra'})),b=JSON.parse(await ref.screenshot({format:'bgra'}));
   expect(await Bun.file(a.path).bytes()).toEqual(await Bun.file(b.path).bytes());unlinkSync(a.path);unlinkSync(b.path);
 }}finally{fast.close();ref.close();}
});

import {RawFrames} from '../lib/raw-frames.js';
test('scatter export handles multiple writev batches without changing background bytes',async()=>{
 const frames=new RawFrames(),width=64,height=600,bytes=Buffer.alloc(width*height*4,17);
 const patch={x:3,y:10,width:5,height:550,bytes:Buffer.alloc(5*550*4,92)},expected=Buffer.from(bytes);
 for(let y=0;y<patch.height;y++)expected.set(patch.bytes.subarray(y*20,(y+1)*20),((y+10)*width+3)*4);
 try{const result=JSON.parse(frames.write(bytes,width,height,'bgra',patch));expect(await Bun.file(result.path).bytes()).toEqual(expected);expect(bytes.every(x=>x===17)).toBe(true);}finally{frames.close();}
});

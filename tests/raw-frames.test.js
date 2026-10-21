import {test,expect} from 'bun:test';
import {existsSync,readFileSync,unlinkSync} from 'node:fs';
import {dirname} from 'node:path';
import {RawFrames} from '../lib/raw-frames.js';
import {createWorkerRenderer} from '../lib/worker-renderer.js';
test('raw frames are unique, bounded and owned by producer cleanup',()=>{
 const store=new RawFrames(),frames=[];
 try{
  for(let i=0;i<16;i++)frames.push(JSON.parse(store.write(Buffer.from([1,2,3,255]),1,1,'bgra')));
  expect(new Set(frames.map(f=>f.path)).size).toBe(16);
  expect(()=>store.write(Buffer.alloc(4),1,1,'bgra')).toThrow('stalled');
  unlinkSync(frames[0].path);expect(()=>store.write(Buffer.alloc(4),1,1,'bgra')).not.toThrow();
  expect(frames[1]).toMatchObject({version:1,transport:'file',stride:4,bytes:4});
 }finally{store.close();}
 expect(existsSync(dirname(frames[0].path))).toBe(false);
});
test('worker owns raw directory in parent and removes it even with capture in flight',async()=>{
 const c={width:8,height:8,fastPng:true,input:{},wm:{renderSurfaces:()=>[],origin:()=>({x:0,y:0})}};
 const renderer=await createWorkerRenderer(c);
 const f=JSON.parse(await renderer.screenshot({format:'bgra'}));
 expect(readFileSync(f.path).length).toBe(256);
 const pending=renderer.screenshot({format:'rgba'});renderer.close();
 await expect(pending).rejects.toThrow('closed');
 await Bun.sleep(20);
 expect(existsSync(dirname(f.path))).toBe(false);
});

test('renderer clips fractional CSS dimensions before raw output in both composition paths',async()=>{
 const {createRenderer}=await import('../lib/renderer.js');
 for(const directComposition of [true,false]) {
  const c={width:16,height:9,deviceScaleFactor:1.75,input:{},wm:{renderSurfaces:()=>[],origin:()=>({x:0,y:0})}};
  const renderer=await createRenderer(c,{directComposition});
  try {
   for(const format of ['rgba','bgra']) {
    const clip={x:0,y:0,width:16,height:15/1.75,scale:1};
    const frame=JSON.parse(await renderer.screenshot({format,clip}));
    expect([frame.width,frame.height,frame.bytes]).toEqual([28,15,28*15*4]);
    const png=Buffer.from(await renderer.screenshot({format:'png',clip,maxWidth:8,maxHeight:4}),'base64');
    expect([png.readUInt32BE(16),png.readUInt32BE(20)]).toEqual([28,15]);
    const doubled=JSON.parse(await renderer.screenshot({format,clip:{...clip,scale:2}}));
    expect([doubled.width,doubled.height]).toEqual([56,30]);
    await expect(renderer.screenshot({format,clip:{...clip,width:-1}})).rejects.toThrow();
   }
  }finally{renderer.close();}
 }
});

test('clip offsets crop the same scene in direct and CanvasKit paths without stale cache',async()=>{
 const {createRenderer}=await import('../lib/renderer.js');
 const bytes=Buffer.alloc(4*4*4);for(let i=0;i<16;i++)bytes.set([i,20+i,40+i,255],i*4);
 const surface={pixels:{bytes,width:4,height:4,stride:16,format:1},scale:1,transform:0,x:0,y:0};
 for(const directComposition of [true,false]) {
  const renderer=await createRenderer({width:4,height:4,input:{},wm:{renderSurfaces:()=>[surface],origin:()=>({x:0,y:0})}},{directComposition});
  try {
   for(const x of [0,1,2]) {
    const frame=JSON.parse(await renderer.screenshot({format:'bgra',clip:{x,y:1,width:2,height:2,scale:1}}));
    const expected=Buffer.concat([bytes.subarray((4+x)*4,(6+x)*4),bytes.subarray((8+x)*4,(10+x)*4)]);
    expect(readFileSync(frame.path)).toEqual(expected);
   }
  }finally{renderer.close();}
 }
});

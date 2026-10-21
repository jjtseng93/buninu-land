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

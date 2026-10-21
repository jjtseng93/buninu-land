import {test,expect} from 'bun:test';
import {readFileSync,writeFileSync,unlinkSync,existsSync} from 'node:fs';
import {patchRenderer,patchKitty} from './patch.js';

test('raw-file experiment preserves pixels, unique ownership and cleanup',async()=>{
 let renderer;
 try {
  const {createRenderer}=await import('../../../lib/renderer.js');
  for(const directComposition of [true,false]) {
  renderer=await createRenderer({width:8,height:8,fastPng:true,input:{},wm:{renderSurfaces:()=>[]}},{directComposition});
  const png=await renderer.screenshot();
  const a=JSON.parse(await renderer.screenshot({format:'rgba'}));
  const b=JSON.parse(await renderer.screenshot({format:'rgba'}));
  expect(a.path).not.toBe(b.path);
  expect(a.bytes).toBe(8*8*4);
  expect(readFileSync(a.path)).toEqual(readFileSync(b.path));
  expect(await renderer.screenshot()).toBe(png);
  renderer.close();renderer=null;
  expect(existsSync(a.path)).toBe(false);
  }
 }finally{renderer?.close();}
});

test('Casty forwards descriptor without loading pixel bytes',()=>{
 const source=patchKitty('function sendFrameFile(base64Data) {}\n// Inline mode');
 expect(source).toContain('t=t');
 expect(source).not.toContain('writeFileSync');
 expect(source).toContain('frame.width');
});

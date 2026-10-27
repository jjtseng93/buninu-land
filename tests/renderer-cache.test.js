import {test,expect} from 'bun:test';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
import {createRenderer} from '../lib/renderer.js';
test('cache follows immutable pixels, geometry, stacking, cursor and output dimensions',async()=>{
 // CanvasKit only decodes the PNG output here.
 const CK=await CanvasKitInit({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()});
 const pixels=(b,g,r)=>({bytes:Buffer.from([b,g,r,255,b,g,r,255,b,g,r,255,b,g,r,255]),width:2,height:2,stride:8,format:1});
 const red={pixels:pixels(0,0,255),scale:1,transform:0,x:0,y:0},blue={pixels:pixels(255,0,0),scale:1,transform:0,x:0,y:0};
 let visible=[red];
 const comp={width:8,height:8,input:{},wm:{renderSurfaces:()=>visible,origin:s=>({x:s.x,y:s.y})}};
 const renderer=await createRenderer(comp);
 const capture=async(opts={})=>{
  const data=await renderer.screenshot(opts),image=CK.MakeImageFromEncoded(Buffer.from(data,'base64'));
  try{return {data,bytes:image.readPixels(0,0,{width:image.width(),height:image.height(),colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB})};}finally{image.delete();}
 };
 try {
  const first=await capture();expect([...first.bytes.slice(0,4)]).toEqual([255,0,0,255]);
  expect((await capture()).data).toBe(first.data);
  await capture({maxWidth:4});expect((await capture()).data).toBe(first.data);
  red.x=2;expect((await capture()).data).not.toBe(first.data);
  red.x=0;red.pixels=pixels(0,255,0);expect([...(await capture()).bytes.slice(0,4)]).toEqual([0,255,0,255]);
  visible=[red,blue];expect([...(await capture()).bytes.slice(0,4)]).toEqual([0,0,255,255]);
  visible=[blue,red];expect([...(await capture()).bytes.slice(0,4)]).toEqual([0,255,0,255]);
  const before=(await capture()).data;red.scale=2;const scaled=(await capture()).data;expect(scaled).not.toBe(before);
  red.transform=1;await capture();
  comp.input.pointer=true;comp.input.x=4;comp.input.y=4;const pointer=await capture();comp.input.x=5;expect((await capture()).data).not.toBe(pointer.data);
  comp.input.cursor={surface:blue,x:0,y:0};await capture();expect(visible).toHaveLength(2);
  comp.input.cursor=null;comp.input.pointer=false;visible=[];
  expect([...(await capture()).bytes.slice(0,4)]).toEqual([24,27,34,255]);
  comp.width=4;comp.height=4;expect((await capture()).bytes.length).toBe(64);
  // An asynchronous encoder has its own pixels even if close releases all caches.
  const pending=renderer.screenshot({format:'jpeg'});renderer.close();expect((await pending).length).toBeGreaterThan(0);
 } finally {renderer.close();}
});

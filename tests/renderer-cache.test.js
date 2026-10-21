import {test,expect} from 'bun:test';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';
import {createRenderer} from '../lib/renderer.js';
test('cache follows immutable pixels, geometry, stacking, cursor and output dimensions',async()=>{
 const CK=await CanvasKitInit({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()});
 let uploads=0,targets=0,draws=0,imageDeletes=0;
 const makeImage=CK.MakeImage,makeSurface=CK.MakeSurface,drawImage=CK.Canvas.prototype.drawImage,drawOptions=CK.Canvas.prototype.drawImageOptions;
 CK.MakeImage=(...args)=>{uploads++;const image=makeImage(...args),del=image.delete.bind(image);image.delete=()=>{imageDeletes++;del();};return image;};
 CK.MakeSurface=(...args)=>{targets++;return makeSurface(...args);};
 CK.Canvas.prototype.drawImageOptions=function(...args){draws++;return drawOptions.apply(this,args);};
 CK.Canvas.prototype.drawImage=function(...args){draws++;return drawImage.apply(this,args);};
 const pixels=(b,g,r)=>({bytes:Buffer.from([b,g,r,255,b,g,r,255,b,g,r,255,b,g,r,255]),width:2,height:2,stride:8,format:1});
 const red={pixels:pixels(0,0,255),scale:1,transform:0,x:0,y:0},blue={pixels:pixels(255,0,0),scale:1,transform:0,x:0,y:0};
 let visible=[red];
 const comp={width:8,height:8,input:{},wm:{renderSurfaces:()=>visible,origin:s=>({x:s.x,y:s.y})}};
 const renderer=await createRenderer(comp,{canvasKit:CK,directComposition:false});
 const capture=async(opts={})=>{
  const data=await renderer.screenshot(opts),image=CK.MakeImageFromEncoded(Buffer.from(data,'base64'));
  try{return {data,bytes:image.readPixels(0,0,{width:image.width(),height:image.height(),colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB})};}finally{image.delete();}
 };
 try {
  const previewOnly=await createRenderer(comp,{canvasKit:CK,directComposition:false});
  await previewOnly.screenshot({maxWidth:4});expect(targets).toBe(1);
  red.x=1;await previewOnly.screenshot({maxWidth:4});expect(targets).toBe(1);
  previewOnly.close();red.x=0;uploads=targets=draws=imageDeletes=0;
  const first=await capture();expect([...first.bytes.slice(0,4)]).toEqual([255,0,0,255]);
  expect((await capture()).data).toBe(first.data);expect(uploads).toBe(1);expect(targets).toBe(1);expect(draws).toBe(1);
  await capture({maxWidth:4});await capture({maxWidth:4});expect(uploads).toBe(1);expect(targets).toBe(2);expect(draws).toBe(2);
  red.x=2;expect((await capture()).data).not.toBe(first.data);expect(uploads).toBe(1);expect(targets).toBe(2);
  await capture({maxWidth:4});expect(targets).toBe(2);
  red.x=0;red.pixels=pixels(0,255,0);expect([...(await capture()).bytes.slice(0,4)]).toEqual([0,255,0,255]);expect(uploads).toBe(2);
  visible=[red,blue];expect([...(await capture()).bytes.slice(0,4)]).toEqual([0,0,255,255]);
  visible=[blue,red];expect([...(await capture()).bytes.slice(0,4)]).toEqual([0,255,0,255]);expect(uploads).toBe(3);
  const before=draws;red.scale=2;await capture();red.transform=1;await capture();expect(draws).toBe(before+4);
  comp.input.pointer=true;comp.input.x=4;comp.input.y=4;const pointer=await capture();comp.input.x=5;expect((await capture()).data).not.toBe(pointer.data);
  comp.input.cursor={surface:blue,x:0,y:0};await capture();expect(visible).toHaveLength(2);
  comp.input.cursor=null;comp.input.pointer=false;visible=[];
  expect([...(await capture()).bytes.slice(0,4)]).toEqual([24,27,34,255]);
  expect(imageDeletes).toBe(uploads);
  comp.width=4;comp.height=4;expect((await capture()).bytes.length).toBe(64);
  // An asynchronous encoder has its own pixels even if close releases all caches.
  const pending=renderer.screenshot({format:'jpeg'});renderer.close();expect((await pending).length).toBeGreaterThan(0);
 } finally {renderer.close();CK.Canvas.prototype.drawImage=drawImage;CK.Canvas.prototype.drawImageOptions=drawOptions;}
});

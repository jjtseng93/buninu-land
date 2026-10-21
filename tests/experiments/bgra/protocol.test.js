import {test,expect} from 'bun:test';
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync,unlinkSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BgraProbe,BGRA_FORMAT,BGRA_REPLY,parsePreference} from '../../../../casty/lib/raw-protocol.js';
import {bgraParser,preferredPixelFormat} from '../../../../buninu-linux/initramfs/lib/bunterm/raw-protocol.js';
import {patchTransport,patchRenderer,patchImages} from './patch.js';
const {KittyGraphicsParser}=createRequire(import.meta.url)('../../../../jsgotty/gotty.js');
const {KittyTransport}=await import('../../../../casty/lib/kitty-transport.js');

test('BGRA requires versioned acknowledgement; rejects plain OK/errors/timeouts/late replies',async()=>{
 for(const reply of [BGRA_REPLY,'OK','OK;BUNINU_BGRA_V1','OK BUNINU1 bgra','OK Buninu1 rgba','ENOTSUPPORTED:','EINVAL: unsupported format',null]){
  let wire,removed=0;
  const probe=new BgraProbe({write:s=>wire=s,createFile:()=>'/tmp/probe',removeFile:()=>removed++,timeout:10});
  const t=new KittyTransport({write(){},createProbe(){},removeProbe(){},onReply:(id,msg)=>probe.reply(id,msg)});
  const result=probe.query();
  expect(wire).toContain('a=q,t=f');expect(wire).not.toContain('a=T');
  t.feed(`\x1b_Gi=${probe.id+1};${BGRA_REPLY}\x1b\\`,()=>{});
  if(reply){t.feed(`\x1b_Gi=${probe.id};${reply.slice(0,2)}`,()=>{});t.feed(`${reply.slice(2)}\x1b\\`,()=>{});}
  expect(await result).toBe(parsePreference(reply));
  t.feed(`\x1b_Gi=${probe.id};${BGRA_REPLY}\x1b\\`,()=>{throw Error('reply leaked into input');});
  expect(removed).toBe(1);t.stop();
 }
});

test('native parser advertises BGRA only on opt-in and validates data without placement',()=>{
 const dir=mkdtempSync(join(tmpdir(),'bgra-query-test-')),path=join(dir,'p');
 try{
  writeFileSync(path,Buffer.from([1,2,3,255]));
  const packet=Buffer.from(`a=q,f=${BGRA_FORMAT},t=f,s=1,v=1,i=71;${Buffer.from(path).toString('base64')}`);
  const legacy=new KittyGraphicsParser(),native=new (bgraParser(KittyGraphicsParser,fb()))({binaryData:true});
  expect(legacy.parsePacket(packet,{}).responseMessage).toBe('OK');
  expect(native.parsePacket(packet,{}).responseMessage).toBe(BGRA_REPLY);
  expect(native.images.size).toBe(0);
  writeFileSync(path,Buffer.alloc(3));
  expect(native.parsePacket(packet,{}).responseMessage).not.toBe(BGRA_REPLY);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('BGRA direct and CanvasKit fallback preserve colored pixels through native decoding',async()=>{
 const {decodeImage}=await import('../../../../buninu-linux/initramfs/lib/bunterm/images.js');
 let renderer;
 try{
  const {createRenderer}=await import('../../../lib/renderer.js');
  const {default:init}=await import('../../../vendor/canvaskit/canvaskit.js');
  const CK=await init({wasmBinary:readFileSync(new URL('../../../vendor/canvaskit/canvaskit.wasm',import.meta.url))});
  const s={pixels:{width:2,height:1,stride:8,format:1,bytes:Buffer.from([7,19,239,255,211,37,11,255])},scale:1,transform:0,origin:{x:0,y:0}};
  const comp={width:2,height:1,fastPng:true,input:{},wm:{renderSurfaces:()=>[s],origin:()=>({x:0,y:0})}};
  for(const directComposition of [true,false])for(const format of ['bgra','rgba']){
   renderer=await createRenderer(comp,{canvasKit:CK,directComposition});
   const png=await renderer.screenshot();
   const d=JSON.parse(await renderer.screenshot({format}));
   expect(d.format).toBe(format);
   const image=await decodeImage(CK,{format:format==='bgra'?BGRA_FORMAT:32,width:d.width,height:d.height,data:readFileSync(d.path)});
   const reference=CK.MakeImageFromEncoded(Buffer.from(png,'base64'));
   const info={width:2,height:1,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB};
   expect(image.readPixels(0,0,info)).toEqual(reference.readPixels(0,0,info));
   expect(image.readPixels(0,0,info)[0]).toBe(239);
   image.delete();reference.delete();renderer.close();renderer=null;
  }
 }finally{renderer?.close();}
});

function fb(red=16,blue=0) {
 const field=offset=>({offset,length:8,msbRight:0});
 return {bitsPerPixel:32,fields:{red:field(red),green:field(8),blue:field(blue),transp:field(24)}};
}
test('framebuffer preference uses bitfields, depth, byte order and rejects unknown layouts',()=>{
 expect(preferredPixelFormat(fb())).toBe('bgra');
 expect(preferredPixelFormat(fb(0,16))).toBe('rgba');
 const x=fb();x.fields.transp.length=0;
 expect(preferredPixelFormat(x)).toBe('bgra');
 x.bitsPerPixel=16;expect(preferredPixelFormat(x)).toBe('png');
 x.bitsPerPixel=24;expect(preferredPixelFormat(x)).toBe('png');
 const bad=fb();bad.fields.red.msbRight=1;
 expect(preferredPixelFormat(bad)).toBe('png');
 const alpha=fb();alpha.fields.transp.offset=0;
 expect(preferredPixelFormat(alpha)).toBe('png');
 expect(preferredPixelFormat(fb(),false)).toBe('png');
 expect(preferredPixelFormat(undefined)).toBe('png');
 for(const display of [fb(),fb(0,16),{bitsPerPixel:16}]){
  const Parser=bgraParser(KittyGraphicsParser,display),p=new Parser();
  const r=p.parsePacket(Buffer.from(`a=q,f=${BGRA_FORMAT},s=1,v=1,i=42;AAAA/w==`),{});
  expect(r.responseMessage).toBe('OK Buninu1 '+preferredPixelFormat(display));
 }
});

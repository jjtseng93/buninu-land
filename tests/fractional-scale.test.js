import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Compositor} from '../lib/compositor.js';
import {interfaces,decode} from '../lib/protocol.js';
import {surfaceViewport} from '../lib/viewport.js';
import {createRenderer} from '../lib/renderer.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';

test('viewport protocol state stays double buffered, including synchronized children',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'buninu-viewport-')),'wayland-test'),comp=new Compositor({socket:path});let socket;
 try{
  socket=await Bun.connect({unix:path,socket:{data(){},error(){},close(){}}});
  for(let i=0;i<100&&!comp.clients.size;i++)await Bun.sleep(5);
  const c=[...comp.clients][0],factory=c.add(2,'wl_compositor',4),vp=c.add(3,'wp_viewporter'),fs=c.add(4,'wp_fractional_scale_manager_v1');
  c.request(factory,'create_surface',[5]);const s=c.object(5),events=[],send=c.event.bind(c);c.event=(o,n,...a)=>{events.push([o.id,n,...a]);send(o,n,...a)};
  comp.deviceScaleFactor=.6;c.request(fs,'get_fractional_scale',[6,5]);expect(events.at(-1)).toEqual([6,'preferred_scale',72]);
  comp.updatePreferredScale();expect(events.filter(e=>e[1]==='preferred_scale')).toHaveLength(1);
  comp.deviceScaleFactor=1.25;comp.updatePreferredScale();expect(events.at(-1)).toEqual([6,'preferred_scale',150]);
  expect(()=>c.request(fs,'get_fractional_scale',[7,5])).toThrow('already');
  c.request(vp,'get_viewport',[7,5]);const v=c.object(7);expect(()=>c.request(vp,'get_viewport',[8,5])).toThrow('already');
  s.pixels={width:6,height:12,bytes:Buffer.alloc(6*12*4),stride:24,format:1};
  c.request(v,'set_destination',[10,20]);expect(surfaceViewport(s).width).toBe(6);
  c.commit(s);expect(surfaceViewport(s).width).toBe(10);
  comp.wm.renderSurfaces=()=>[s];expect(comp.wm.hit(9,19)?.surface).toBe(s);expect(comp.wm.hit(10,19)).toBeNull();
  c.request(v,'set_source',[1,.5,4,10]);c.commit(s);expect(surfaceViewport(s).source).toEqual([1,.5,4,10]);
  expect(()=>c.request(v,'set_destination',[-1,2])).toThrow('Invalid');
  expect(()=>c.request(v,'set_source',[-1,0,1,1])).toThrow('Invalid');
  c.request(v,'set_source',[0,0,7,12]);expect(()=>c.commit(s)).toThrow('outside');
  c.request(v,'set_source',[0,0,3.5,4]);c.request(v,'set_destination',[-1,-1]);expect(()=>c.commit(s)).toThrow('integral');
  c.request(v,'set_source',[-1,-1,-1,-1]);c.commit(s);
  c.request(v,'set_destination',[10,20]);c.commit(s);
  c.request(v,'destroy',[]);expect(surfaceViewport(s).width).toBe(10);c.commit(s);expect(surfaceViewport(s).width).toBe(6);
  c.request(vp,'get_viewport',[8,5]);c.request(c.object(6),'destroy',[]);c.request(fs,'get_fractional_scale',[9,5]);
  c.request(factory,'create_surface',[10]);const sub=c.add(11,'wl_subcompositor');c.request(sub,'get_subsurface',[12,5,10]);
  c.request(c.object(8),'set_destination',[15,30]);c.commit(s);expect(surfaceViewport(s).width).toBe(6);c.commit(c.object(10));expect(surfaceViewport(s).width).toBe(15);
  c.destroy(s);expect(()=>c.request(c.object(8),'set_destination',[2,2])).toThrow('no surface');c.destroy(c.object(8));c.destroy(c.object(9));
  const spec=interfaces.get('wp_viewport').requests.find(r=>r.name==='set_source'),wire=Buffer.alloc(24);
  [-256,128,896,1024].forEach((v,i)=>wire.writeInt32LE(v,8+i*4));expect(decode(spec,wire,[])).toEqual([-1,.5,3.5,4]);
 }finally{socket?.end();comp.close();}
});

test('fractional buffers preserve each pixel and viewport changes invalidate cached composition',async()=>{
 const CK=await CanvasKitInit({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()});
 const bytes=Buffer.alloc(6*12*4);for(let y=0;y<12;y++)for(let x=0;x<6;x++){let v=(x+y)%2?255:0;bytes.set([v,v,v,255],(y*6+x)*4);}
 const s={pixels:{bytes,width:6,height:12,stride:24,format:1},scale:1,transform:0,fractionalScale:{},viewportDestination:[10,20]};
 const comp={width:10,height:20,deviceScaleFactor:.6,input:{},wm:{renderSurfaces:()=>[s],origin:()=>({x:0,y:0})}},r=await createRenderer(comp,{canvasKit:CK});
 const capture=async()=>{const data=await r.screenshot(),im=CK.MakeImageFromEncoded(Buffer.from(data,'base64'));try{return Buffer.from(im.readPixels(0,0,{width:im.width(),height:im.height(),colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB}))}finally{im.delete()}};
 try{expect(await capture()).toEqual(bytes);s.viewportDestination=[11,22];comp.width=11;comp.height=22;comp.deviceScaleFactor=.55;expect(await capture()).toEqual(bytes);s.viewportDestination=[10,20];comp.width=10;comp.height=20;comp.deviceScaleFactor=.6;s.viewportSource=[1,0,5,12];expect(await capture()).not.toEqual(bytes);s.viewportSource=null;expect(await capture()).toEqual(bytes);s.transform=1;s.viewportDestination=[20,10];comp.width=20;comp.height=10;expect(surfaceViewport(s).source).toEqual([0,0,12,6]);
  const rotated=Buffer.alloc(bytes.length);for(let y=0;y<6;y++)for(let x=0;x<12;x++)bytes.copy(rotated,(y*12+x)*4,(x*6+5-y)*4,(x*6+5-y)*4+4);
  expect(await capture()).toEqual(rotated);s.scale=2;expect(surfaceViewport(s).source).toEqual([0,0,6,3]);expect(await capture()).toEqual(rotated);}finally{r.close()}
});

import {test,expect} from 'bun:test';
import {ptr} from 'bun:ffi';
import {mkdtempSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DmabufParams,linearFormats,deferDmabuf} from '../lib/dmabuf.js';
import {Compositor} from '../lib/compositor.js';
import {flushDesynchronized} from '../lib/subsurface.js';
const fake=()=>{
 const bytes=Buffer.from([1,2,3,255,4,5,6,255]),calls=[];
 return {bytes,calls,sys:{close:fd=>calls.push(['close',fd]),lseek:()=>8,
  ioctl(fd,op,b){calls.push(['sync',Number(b.readBigUInt64LE())]);return 0;},
  mmap:()=>ptr(bytes),munmap:()=>calls.push(['unmap'])}};
};
test('linear DMA-BUF import snapshots under read synchronization and releases ownership once',()=>{
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 const b=p.create(2,1,linearFormats[0],0);expect(b.format).toBe(0);
 p.close();expect(f.calls.some(c=>c[0]==='close')).toBe(false);
 const copy=b.snapshot();expect(copy).toEqual(f.bytes);f.bytes[0]=99;expect(copy[0]).toBe(1);
 expect(f.calls.filter(c=>c[0]==='sync')).toEqual([['sync',1],['sync',5],['sync',1],['sync',5]]);
 b.close();b.close();expect(f.calls.slice(-2)).toEqual([['unmap'],['close',9]]);
 expect(()=>p.create(2,1,linearFormats[0],0)).toThrow('already used');
});
test('DMA-BUF rejects invalid metadata and closes rejected descriptors',()=>{
 for(const [width,height,stride,format,hi,lo,flags,expected] of [
  [0,1,8,linearFormats[0],0,0,0,'dimensions'],[2,1,4,linearFormats[0],0,0,0,'stride'],
  [2,2,8,linearFormats[0],0,0,0,'fd size'],[2,1,8,123,0,0,0,'format'],
  [2,1,8,linearFormats[0],0,1,0,null],[2,1,8,linearFormats[0],0,0,1,null],
 ]){
  const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,stride,hi,lo);
  if(expected)expect(()=>p.create(width,height,format,flags)).toThrow(expected);
  else expect(p.create(width,height,format,flags)).toBeNull();
  expect(f.calls.at(-1)).toEqual(['close',9]);
 }
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 expect(()=>p.add(10,0,0,8,0,0)).toThrow('already set');expect(f.calls.at(-1)).toEqual(['close',10]);
 p.close();expect(f.calls.at(-1)).toEqual(['close',9]);
});
test('DMA-BUF failures finish CPU access and do not leak imported mappings',()=>{
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 const b=p.create(2,1,linearFormats[1],0);expect(b.format).toBe(1);
 f.sys.ioctl=()=>-1;expect(()=>b.snapshot()).toThrow('synchronization');b.close();
 expect(f.calls.slice(-2)).toEqual([['unmap'],['close',9]]);
});
test('optional DMA-BUF registry, failed async import, and server object lifecycle',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'land-dma-')),comp=new Compositor({socket:join(dir,'wl'),linearDmabuf:true});let socket;
 try{
  socket=await Bun.connect({unix:join(dir,'wl'),socket:{data(){},close(){},error(){}}});
  for(let i=0;i<100&&!comp.clients.size;i++)await Bun.sleep(5);
  const c=[...comp.clients][0],events=[];c.event=(o,name,...args)=>events.push([o.id,name,...args]);
  const registry=c.add(2,'wl_registry'),global=comp.globals.findIndex(([s])=>s==='zwp_linux_dmabuf_v1')+1;
  c.request(registry,'bind',[global,'zwp_linux_dmabuf_v1',3,3]);
  expect(events.filter(e=>e[1]==='modifier').map(e=>e.slice(2))).toEqual(linearFormats.map(f=>[f,0,0]));
  c.request(c.object(3),'create_params',[4]);
  const file=join(dir,'not-dma');writeFileSync(file,Buffer.alloc(8));const fd=openSync(file,'r');
  c.request(c.object(4),'add',[fd,0,0,8,0,0]);c.request(c.object(4),'create',[2,1,linearFormats[0],0]);
  expect(events.at(-1)).toEqual([4,'failed']);expect(()=>closeSync(fd)).toThrow();
  expect(()=>c.request(c.object(4),'create',[2,1,linearFormats[0],0])).toThrow('already used');
  c.request(c.object(3),'create_params',[5]);const f=fake();c.object(5).dmabufParams=new DmabufParams(f.sys);
  c.request(c.object(5),'add',[9,0,0,8,0,0]);c.request(c.object(5),'create',[2,1,linearFormats[0],0]);
  const id=events.at(-1)[2];expect(id).toBeGreaterThanOrEqual(0xff000000);
  expect(c.snapshot(c.object(id)).bytes).toEqual(f.bytes);
  c.destroy(c.object(id));expect(events.some(e=>e[1]==='delete_id'&&e[2]===id)).toBe(false);
  expect(f.calls.at(-1)).toEqual(['close',9]);
 }finally{socket?.end();comp.close();}
});

test('deferred DMA-BUF holds mapping after wl_buffer destruction, copies once, and releases once',()=>{
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 const dmabuf=p.create(2,1,linearFormats[0],0),buffer={...dmabuf,dmabuf};let releases=0;
 const frame=deferDmabuf(buffer,()=>releases++);
 dmabuf.close();expect(f.calls.some(c=>c[0]==='unmap')).toBe(false);
 const copy=frame.bytes;expect(copy).toEqual(f.bytes);f.bytes[0]=88;
 expect(frame.bytes).toBe(copy);expect(frame.bytes[0]).toBe(1);expect(releases).toBe(1);
 frame.dispose();expect(releases).toBe(1);expect(f.calls.filter(c=>c[0]==='unmap').length).toBe(1);
});
test('dropping deferred frames avoids readback and waits for all uses before release',()=>{
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 const dmabuf=p.create(2,1,linearFormats[0],0),buffer={...dmabuf,dmabuf};let releases=0;
 const a=deferDmabuf(buffer,()=>releases++),b=deferDmabuf(buffer,()=>releases++);
 a.dispose();expect(releases).toBe(0);b.dispose();expect(releases).toBe(1);
 expect(f.calls.filter(c=>c[0]==='sync').length).toBe(2); // import probe only
 expect(()=>a.bytes).toThrow('Discarded');dmabuf.close();
});
test('deferred read failure still releases mapping ownership',()=>{
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 const dmabuf=p.create(2,1,linearFormats[0],0),buffer={...dmabuf,dmabuf};let releases=0;
 const a=deferDmabuf(buffer,()=>releases++);dmabuf.close();f.sys.ioctl=()=>-1;
 expect(()=>a.bytes).toThrow('synchronization');expect(releases).toBe(1);
 expect(f.calls.at(-1)).toEqual(['close',9]);expect(()=>a.bytes).toThrow('synchronization');expect(releases).toBe(1);
});

test('deferred commits release replaced and cached buffers and survive destroyed wl_buffer',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'land-dma-lazy-')),comp=new Compositor({socket:join(dir,'wl'),linearDmabuf:true});let socket;
 comp.lazyDmabuf=true;
 try{
  socket=await Bun.connect({unix:join(dir,'wl'),socket:{data(){},close(){},error(){}}});
  for(let i=0;i<100&&!comp.clients.size;i++)await Bun.sleep(5);
  const c=[...comp.clients][0],events=[];c.event=(o,name,...args)=>events.push([o.id,name,...args]);
  c.request(c.add(2,'wl_compositor'),'create_surface',[3]);const surface=c.object(3);
  const make=id=>{const f=fake(),p=new DmabufParams(f.sys);p.add(id,0,0,8,0,0);const dma=p.create(2,1,linearFormats[0],0);return {f,buffer:c.add(id,'wl_buffer',1,{dmabuf:dma,width:2,height:1,stride:8,format:0})};};
  const a=make(4),b=make(5);
  surface.pending={buffer:a.buffer};c.commit(surface);expect(events.filter(e=>e[1]==='release')).toHaveLength(0);
  surface.pending={buffer:b.buffer};c.commit(surface);expect(events.filter(e=>e[1]==='release')).toEqual([[4,'release']]);
  c.destroy(b.buffer);expect(b.f.calls.some(e=>e[0]==='unmap')).toBe(false);
  expect(surface.pixels.bytes).toEqual(b.f.bytes);expect(b.f.calls.at(-1)).toEqual(['close',5]);
  expect(events.some(e=>e[0]===5&&e[1]==='release')).toBe(false);
  surface.subsurface={sync:true,parent:{}};
  const d=make(6),e=make(7);surface.pending={buffer:d.buffer};c.commit(surface);
  surface.pending={buffer:e.buffer};c.commit(surface);expect(events.some(e=>e[0]===6&&e[1]==='release')).toBe(true);
  c.destroy(surface);expect(events.some(e=>e[0]===7&&e[1]==='release')).toBe(true);
  c.destroy(d.buffer);c.destroy(e.buffer);expect(e.f.calls.at(-1)).toEqual(['close',7]);
 }finally{socket?.end();comp.close();}
});

test('failed cached subsurface application releases its deferred snapshot',()=>{
 const f=fake(),p=new DmabufParams(f.sys);p.add(9,0,0,8,0,0);
 const dmabuf=p.create(2,1,linearFormats[0],0),buffer={...dmabuf,dmabuf};let released=0;
 const snapshot=deferDmabuf(buffer,()=>released++),pending={};dmabuf.close();
 const surface={pending,cached:{snapshot},client:{commit(){throw Error('invalid configure');}}};
 expect(()=>flushDesynchronized(surface)).toThrow('invalid configure');
 expect(released).toBe(1);expect(surface.pending).toBe(pending);expect(f.calls.at(-1)).toEqual(['close',9]);
});

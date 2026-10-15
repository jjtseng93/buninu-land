import {test,expect} from 'bun:test';
import {mkdtempSync,openSync,writeSync,closeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Compositor} from '../lib/compositor.js';

test('subsurfaces cache SHM snapshots until parent commit; positions, stacking and desync apply correctly',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'buninu-sub-')),comp=new Compositor({socket:join(dir,'wayland-test')});let socket,fd;
  try{
    socket=await Bun.connect({unix:join(dir,'wayland-test'),socket:{data(){},error(){},close(){}}});
    const deadline=Date.now()+2000;while(!comp.clients.size){if(Date.now()>deadline)throw Error('No client');await Bun.sleep(5);}
    const c=[...comp.clients][0],factory=c.add(2,'wl_compositor',4),subfactory=c.add(3,'wl_subcompositor');
    for(const id of [4,5,6])c.request(factory,'create_surface',[id]);
    const parent=c.object(4),child=c.object(5),grandchild=c.object(6);
    c.request(subfactory,'get_subsurface',[7,5,4]);const role=c.object(7);
    c.request(subfactory,'get_subsurface',[8,6,5]);const nested=c.object(8);
    expect(()=>c.request(subfactory,'get_subsurface',[9,4,6])).toThrow('cycle');
    fd=openSync(join(dir,'pixels'),'w+');writeSync(fd,Buffer.from([10,20,30,255]));
    const buffer=c.add(10,'wl_buffer',1,{pool:{fd,refs:1},width:1,height:1,stride:4,offset:0,format:0});
    c.request(child,'attach',[10,0,0]);c.request(child,'frame',[11]);c.request(child,'commit',[]);
    expect(child.pixels).toBeNull();expect(child.callbacks).toHaveLength(0);
    // The buffer is released after copying. Reuse must not alter cached content.
    writeSync(fd,Buffer.from([90,80,70,255]),0,4,0);
    c.request(role,'set_position',[12,34]);expect(comp.wm.origin(child)).toEqual({x:0,y:0});
    c.request(parent,'commit',[]);
    expect([...child.pixels.bytes]).toEqual([10,20,30,255]);
    expect(child.callbacks).toHaveLength(1);expect(comp.wm.origin(child)).toEqual({x:12,y:34});
    c.request(role,'place_below',[4]);expect(parent.stack).toEqual([parent,child]);
    c.request(parent,'commit',[]);expect(parent.stack).toEqual([child,parent]);
    c.request(child,'attach',[10,0,0]);c.request(child,'commit',[]);
    expect([...child.pixels.bytes]).toEqual([10,20,30,255]);
    c.request(role,'set_desync',[]);expect([...child.pixels.bytes]).toEqual([90,80,70,255]);
    // A desynchronized child still inherits a synchronized ancestor.
    c.request(role,'set_sync',[]);c.request(nested,'set_desync',[]);
    c.request(grandchild,'attach',[10,0,0]);c.request(grandchild,'commit',[]);expect(grandchild.pixels).toBeNull();
    c.request(parent,'commit',[]);expect(grandchild.pixels).not.toBeNull();
    // Ancestor mode changes release desynchronized descendants too.
    c.request(grandchild,'attach',[0,0,0]);c.request(grandchild,'commit',[]);
    expect(grandchild.pixels).not.toBeNull();
    c.request(role,'set_desync',[]);expect(grandchild.pixels).toBeNull();
    // A root commit must not apply a desynchronized child's child positions.
    c.request(nested,'set_position',[7,9]);c.request(parent,'commit',[]);
    expect(nested.x).toBe(0);
    c.request(child,'commit',[]);expect(nested.x).toBe(7);
    c.request(role,'destroy',[]);expect(parent.stack).toEqual([parent]);expect(child.subsurface).toBeNull();
    c.objects.delete(buffer.id); // test owns this standalone FD, not a wl_shm_pool
  }finally{socket?.end();comp.close();if(fd!==undefined)closeSync(fd);}
});

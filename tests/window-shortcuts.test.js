import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';

const waitFor=async predicate=>{for(let i=0;i<200;i++){if(predicate())return;await Bun.sleep(20);}throw Error('Timed out waiting for Wayland client');};
test.skipIf(!Bun.which('weston-simple-shm'))('CDP window shortcuts focus, fullscreen, restore and gracefully close real clients',async()=>{
  const old=process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR=mkdtempSync(join(tmpdir(),'buninu-shortcuts-'));
  let app,ws;const children=[];
  try{
    app=await start(['--remote-debugging-port=0']);const wm=app.compositor.wm;
    const launch=()=>{const child=Bun.spawn(['weston-simple-shm'],{env:{...process.env,WAYLAND_DISPLAY:'wayland-buninu'},stdout:'ignore',stderr:'pipe'});children.push(child);return child;};
    const first=launch();await waitFor(()=>wm.visible.length===1);const left=wm.focused;
    expect(left.box).toEqual({x:8,y:8,width:784,height:584});
    const second=launch();await waitFor(()=>wm.visible.length===2);const right=wm.focused;
    expect(right).not.toBe(left);expect(right.box.x).toBeGreaterThan(left.box.x);
    ws=new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let id=0;const pending=new Map();
    ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
    const press=async(key,modifiers=3)=>{for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key,modifiers});};
    await press('ArrowLeft');expect(wm.focused).toBe(left);expect(app.compositor.input.keyboard).toBe(left.surface);
    await press('ArrowRight');expect(wm.focused).toBe(right);
    const box={...right.box};
    await press('f',1);expect(right.fullscreen).toBe(false);
    await press('f',11);expect(right.fullscreen).toBe(false);
    await press('f');expect(right.fullscreen).toBe(true);expect(right.box).toEqual({x:0,y:0,width:800,height:600});
    expect(wm.renderSurfaces()).toEqual([right.surface]);
    await press('ArrowLeft');expect(wm.focused).toBe(left);expect(left.fullscreen).toBe(true);expect(right.fullscreen).toBe(false);
    await press('ArrowRight');expect(wm.focused).toBe(right);expect(right.fullscreen).toBe(true);
    await press('f');expect(right.fullscreen).toBe(false);expect(right.box).toEqual(box);
    // Tab and W without the exact modifiers now belong to applications.
    for(const mods of [0,1,2,8,9,10,11])expect(wm.shortcut('w',mods)).toBe(false);
    for(const mods of [0,1,2,3,8,9,10,11])expect(wm.shortcut('Tab',mods)).toBe(false);
    await press('w');await waitFor(()=>second.exitCode!==null&&wm.visible.length===1);
    expect(second.exitCode).toBe(0);expect(first.exitCode).toBeNull();
    expect(wm.focused).toBe(left);expect(left.box).toEqual({x:8,y:8,width:784,height:584});
    await press('w');await waitFor(()=>first.exitCode!==null&&wm.visible.length===0);
    expect(first.exitCode).toBe(0);expect(wm.focused).toBeNull();
  }finally{
    ws?.close();for(const child of children){if(child.exitCode===null)child.kill();await child.exited;const errors=await new Response(child.stderr).text();if(errors)console.log(errors);}
    app?.close();if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;
  }
},15000);

import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';

test('Ctrl+Alt+arrows and all eight Tab modifier combinations remain independent', async()=>{
  const old=process.env.XDG_RUNTIME_DIR;
  process.env.XDG_RUNTIME_DIR=mkdtempSync(join(tmpdir(),'buninu-input-'));
  let app,ws;
  try{
    app=await start(['--remote-debugging-port=0']);
    ws=new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let id=0;const pending=new Map();
    ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
    const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
    const before=await app.context.screenshot();
    const CK=await CanvasKitInit({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()});
    const toggle=async (key,modifiers)=>{
      await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key,code:key,modifiers});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key,code:key,modifiers});
    };
    const checks=[
      ['ArrowLeft',3,10,60,[0,255,80]],
      ['ArrowRight',3,790,60,[0,140,255]],
      ['ArrowUp',3,400,10,[255,230,0]],
      ['ArrowDown',3,400,590,[255,0,255]],
    ];
    [0,8,2,10,1,9,3,11].forEach((mods,i)=>checks.push(['Tab',mods,272+(i%4)*64+10,236+Math.floor(i/4)*64+10,[0,255,255]]));
    const indicator=(key,mods)=>key==='Tab'?`Tab:${mods}`:key;
    const assertPixels=async active=>{
      const image=CK.MakeImageFromEncoded(Buffer.from(await app.context.screenshot(),'base64'));
      try{
        for(const [key,mods,x,y,color] of checks){
          const rgba=image.readPixels(x,y,{width:1,height:1,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB});
          expect([...rgba].slice(0,3)).toEqual(active.has(indicator(key,mods))?color:[24,27,34]);
          expect(!!app.compositor.keyIndicators?.has(indicator(key,mods))).toBe(active.has(indicator(key,mods)));
        }
      }finally{image.delete();}
    };
    const active=new Set();
    // Several cycles, both independent and simultaneous: no cross-triggering.
    for(let round=0;round<2;round++){
      for(const [key,mods] of checks){await toggle(key,mods);active.add(indicator(key,mods));await assertPixels(active);}
      for(const [key,mods] of [...checks].reverse()){await toggle(key,mods);active.delete(indicator(key,mods));await assertPixels(active);}
    }
    for(const mods of [1,2,3])await toggle('w',mods);
    await toggle('ArrowLeft',1); // Alt alone must not light the Ctrl+Alt probe.
    await assertPixels(active);
    expect(await app.context.screenshot()).toBe(before);
  } finally{ws?.close();app?.close();if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;}
},20000);

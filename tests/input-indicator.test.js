import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
import CanvasKitInit from '../vendor/canvaskit/canvaskit.js';

test('Ctrl+W, Alt+W and Ctrl+Alt+W independently toggle visible CDP indicators', async()=>{
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
    const toggle=async modifiers=>{
      await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:'w',code:'KeyW',modifiers});
      await call('Input.dispatchKeyEvent',{type:'keyUp',key:'w',code:'KeyW',modifiers});
    };
    const checks=[
      [2,'ctrlInputIndicator',30,60,[0,255,80]],
      [1,'altInputIndicator',760,60,[0,140,255]],
      [3,'inputIndicator',0,0,[255,0,255]],
    ];
    const assertPixels=async active=>{
      const image=CK.MakeImageFromEncoded(Buffer.from(await app.context.screenshot(),'base64'));
      try{
        for(const [mods,field,x,y,color] of checks){
          const rgba=image.readPixels(x,y,{width:1,height:1,colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul,colorSpace:CK.ColorSpace.SRGB});
          expect([...rgba].slice(0,3)).toEqual(active.has(mods)?color:[24,27,34]);
          expect(!!app.compositor[field]).toBe(active.has(mods));
        }
      }finally{image.delete();}
    };
    const active=new Set();
    // Several cycles, both independent and simultaneous: no cross-triggering.
    for(let round=0;round<3;round++){
      for(const mods of [2,1,3]){await toggle(mods);active.add(mods);await assertPixels(active);}
      for(const mods of [1,3,2]){await toggle(mods);active.delete(mods);await assertPixels(active);}
    }
    expect(await app.context.screenshot()).toBe(before);
  } finally{ws?.close();app?.close();if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;}
},10000);

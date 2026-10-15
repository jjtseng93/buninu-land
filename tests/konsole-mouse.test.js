import {test,expect} from 'bun:test';
import {existsSync,mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
const waitFor=async predicate=>{for(let i=0;i<250;i++){if(predicate())return;await Bun.sleep(20);}throw Error('Timed out waiting for Konsole mouse input');};
const casty=new URL('../../casty/lib/click.js',import.meta.url);
test.skipIf(!Bun.which('konsole')||!existsSync(casty))('Casty click reaches Konsole and produces terminal mouse reports',async()=>{
  const old=process.env.XDG_RUNTIME_DIR,runtime=mkdtempSync(join(tmpdir(),'buninu-mouse-'));
  process.env.XDG_RUNTIME_DIR=runtime;
  const report=join(runtime,'mouse'),ready=join(runtime,'ready');let app,ws,child,errors;
  try{
    app=await start(['--remote-debugging-port=0']);
    child=Bun.spawn(['konsole','--separate','--nofork','-e','/bin/sh','-c',
      'stty raw -echo; printf "\\033[?1000h\\033[?1006h"; : > "$BUNINU_MOUSE_READY"; exec dd bs=1 of="$BUNINU_MOUSE_REPORT" status=none'],{
      env:{...process.env,WAYLAND_DISPLAY:'wayland-buninu',QT_QPA_PLATFORM:'wayland',BUNINU_MOUSE_REPORT:report,BUNINU_MOUSE_READY:ready},stdout:'ignore',stderr:'pipe'});
    errors=new Response(child.stderr).text();
    await waitFor(()=>existsSync(ready)&&app.compositor.wm.visible.length===1);
    await Bun.sleep(150);
    ws=new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let id=0;const pending=new Map();
    ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
    const send=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
    const {targetId}=await send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await send('Target.attachToTarget',{targetId,flatten:true});
    const client={send:(method,params)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}));})};
    const {dispatchClick}=await import(casty.href);
    await dispatchClick(client,200,200,{button:'left'});
    const text=()=>existsSync(report)?readFileSync(report,'utf8'):'';
    await waitFor(()=>/\x1b\[<0;\d+;\d+M/.test(text())&&/\x1b\[<0;\d+;\d+m/.test(text()));
    expect(text()).toMatch(/\x1b\[<0;\d+;\d+M/);
    expect(text()).toMatch(/\x1b\[<0;\d+;\d+m/);
    expect(child.exitCode).toBeNull();
  }finally{ws?.close();child?.kill();if(child){await child.exited;const log=await errors;if(log.includes('Wayland protocol error'))console.log(log);}app?.close();if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;}
},15000);

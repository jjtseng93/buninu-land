import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';

test('opt-in update notifications avoid rendering while ordinary CDP captures retain pixels',async()=>{
 const previous=process.env.XDG_RUNTIME_DIR,runtime=mkdtempSync(join(tmpdir(),'land-notification-'));
 process.env.XDG_RUNTIME_DIR=runtime;let app,ws;
 try{
  app=await start(['--remote-debugging-port=0','--no-render-worker']);
  const timings=[];app.compositor.measure=(key)=>timings.push(key);
  ws=new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
  await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let id=0,sessionId;const pending=new Map(),frames=[];
  ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else if(m.method==='Page.screencastFrame')frames.push(m.params);};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}));});
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  ({sessionId}=await call('Target.attachToTarget',{targetId,flatten:true}));
  await call('Page.startScreencast',{format:'png',maxWidth:8,maxHeight:6,clip:{x:0,y:0,width:0,height:0,scale:1}});
  for(let i=0;i<100&&!frames.length;i++)await Bun.sleep(5);
  app.compositor.onFrame?.();
  for(let i=0;i<100&&frames.length<2;i++)await Bun.sleep(5);
  expect(frames.length).toBeGreaterThanOrEqual(2);
  for(const frame of frames){const png=Buffer.from(frame.data,'base64');expect(png.readUInt32BE(16)).toBe(1);expect(png.readUInt32BE(20)).toBe(1);}
  expect(timings).toEqual([]);
  await expect(call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:0,height:0,scale:1}})).rejects.toThrow('Invalid screenshot clip');
  const normal=await call('Page.captureScreenshot',{format:'png',clip:{x:0,y:0,width:8,height:6,scale:1}});
  const png=Buffer.from(normal.data,'base64');expect(png.readUInt32BE(16)).toBe(8);expect(png.readUInt32BE(20)).toBe(6);
  expect(timings.length).toBeGreaterThan(0);
  await call('Page.stopScreencast');frames.length=0;
  await call('Page.startScreencast',{format:'png',maxWidth:8,maxHeight:6});
  for(let i=0;i<100&&!frames.length;i++)await Bun.sleep(5);
  expect(Buffer.from(frames[0].data,'base64').readUInt32BE(16)).toBeGreaterThan(1);
 }finally{ws?.close();app?.close();if(previous===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=previous;rmSync(runtime,{recursive:true,force:true});}
});

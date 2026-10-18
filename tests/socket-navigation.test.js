import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
import {CdpServer} from '../lib/cdp-server.js';
async function connect(port){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/devtools/browser/cdp-server`),pending=new Map(),events=[];let id=0;
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 ws.onmessage=({data})=>{const m=JSON.parse(data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else events.push(m);};
 return {ws,events,call:(method,params={},sessionId)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params,sessionId}));})};
}
test('Land reports its selected socket for initial targets, navigation events and history',async()=>{
 const previous=process.env.XDG_RUNTIME_DIR,dir=mkdtempSync(join(tmpdir(),'land-url-'));process.env.XDG_RUNTIME_DIR=dir;
 let first,app,client;
 try{
  first=await start(['--remote-debugging-port=0','--no-render-worker']);
  app=await start(['--remote-debugging-port=0','--no-render-worker']);
  const expected=join(dir,'wayland-buninu1');expect(app.display).toBe('wayland-buninu1');
  const target=await(await fetch(`http://127.0.0.1:${app.server.port}/json/new?https://example.invalid`,{method:'PUT'})).json();
  expect(target.url).toBe(expected);client=await connect(app.server.port);
  expect((await client.call('Page.getFrameTree')).frameTree.frame.url).toBe(expected);
  const {sessionId}=await client.call('Target.attachToTarget',{targetId:target.id,flatten:true});
  for(const url of ['https://example.invalid','about:audio','javascript:throw new Error("not executed")']){
   const before=client.events.length;await client.call('Page.navigate',{url},sessionId);
   for(let i=0;i<100&&!client.events.slice(before).some(e=>e.method==='Page.frameNavigated');i++)await Bun.sleep(5);
   expect(client.events.slice(before).find(e=>e.method==='Page.frameNavigated')?.params.frame.url).toBe(expected);
   const history=await client.call('Page.getNavigationHistory',{},sessionId);
   expect(history.entries[history.currentIndex].url).toBe(expected);
   expect((await client.call('Page.getFrameTree',{},sessionId)).frameTree.frame.url).toBe(expected);
  }
  expect((await(await fetch(`http://127.0.0.1:${app.server.port}/json/list`)).json())[0].url).toBe(expected);
 }finally{client?.ws.close();app?.close();first?.close();if(previous===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=previous;rmSync(dir,{recursive:true,force:true});}
});
test('CDP contexts without a navigation URL hook retain requested URLs',async()=>{
 const server=CdpServer.create({navigate(){}}).listen(0);let client;
 try{
  client=await connect(server.port);await client.call('Page.navigate',{url:'https://example.invalid/'});
  expect((await client.call('Page.getFrameTree')).frameTree.frame.url).toBe('https://example.invalid/');
 }finally{client?.ws.close();server.stop(true);}
});

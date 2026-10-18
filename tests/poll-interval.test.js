import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Transport} from '../lib/transport.js';
import {start} from '../compositor.js';

test('busy polling serves Wayland sync, yields to timers, and releases its socket',async()=>{
 const previous=process.env.XDG_RUNTIME_DIR,dir=mkdtempSync(join(tmpdir(),'land-busy-'));
 process.env.XDG_RUNTIME_DIR=dir;
 let app,socket,replacement;const chunks=[];
 try{
  app=await start(['--remote-debugging-port=0','--poll-interval=-1']);
  socket=await Bun.connect({unix:join(dir,app.display),socket:{data(_,bytes){chunks.push(Buffer.from(bytes));},close(){},error(){}}});
  const request=Buffer.alloc(12);request.writeUInt32LE(1);request.writeUInt32LE(12<<16,4);request.writeUInt32LE(2,8);
  socket.write(request);
  for(let i=0;i<100&&Buffer.concat(chunks).length<24;i++)await Bun.sleep(5);
  const reply=Buffer.concat(chunks);
  expect(reply.length).toBe(24);
  expect(reply.readUInt32LE(0)).toBe(2); // wl_callback.done
  expect(reply.readUInt32LE(12)).toBe(1); // wl_display.delete_id
  expect(reply.readUInt32LE(20)).toBe(2);
  app.close();app.close();
  expect(existsSync(join(dir,app.display))).toBe(false);
  replacement=new Transport(join(dir,app.display),()=>{},-1);
 }finally{
  socket?.end();app?.close();replacement?.close();
  if(previous===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=previous;
  rmSync(dir,{recursive:true,force:true});
 }
});

test('closing busy polling lets the process exit naturally',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'land-busy-exit-'));
 const code=`import {Transport} from ${JSON.stringify(new URL('../lib/transport.js',import.meta.url).href)};
 const t=new Transport(${JSON.stringify(join(dir,'wl'))},()=>{},-1);setTimeout(()=>t.close(),10);`;
 const child=Bun.spawn([process.execPath,'--eval',code],{stdout:'ignore',stderr:'pipe'});
 let timeout;
 try{
  const result=await Promise.race([child.exited,new Promise(resolve=>{timeout=setTimeout(()=>resolve('timeout'),3000);})]);
  expect(result).toBe(0);
 }finally{clearTimeout(timeout);if(child.exitCode===null)child.kill();await child.exited;rmSync(dir,{recursive:true,force:true});}
});

test('invalid poll intervals fail before creating socket files',()=>{
 const dir=mkdtempSync(join(tmpdir(),'land-poll-invalid-')),path=join(dir,'wl');
 try{
  for(const interval of [-2,0,1.5,1001,NaN,Infinity])expect(()=>new Transport(path,()=>{},interval)).toThrow('Invalid socket poll interval');
  expect(existsSync(path+'.lock')).toBe(false);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

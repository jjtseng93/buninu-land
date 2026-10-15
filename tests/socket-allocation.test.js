import {test,expect} from 'bun:test';
import {mkdtempSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';

test('default sockets select the first unlocked name and explicit names remain exclusive',async()=>{
 const old=process.env.XDG_RUNTIME_DIR,dir=mkdtempSync(join(tmpdir(),'buninu-numbered-'));process.env.XDG_RUNTIME_DIR=dir;
 const apps=[];
 try{
  for(let i=0;i<3;i++)apps.push(await start(['--remote-debugging-port=0']));
  expect(apps.map(a=>a.display)).toEqual(['wayland-buninu','wayland-buninu1','wayland-buninu2']);
  await expect(start(['--remote-debugging-port=0','--socket=wayland-buninu1'])).rejects.toThrow('already locked');
  apps[1].close();apps.push(await start(['--remote-debugging-port=0']));expect(apps.at(-1).display).toBe('wayland-buninu1');
  expect(existsSync(join(dir,'wayland-buninu'))).toBe(true);
 }finally{for(const app of apps)app.close();if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;}
},15000);

test('a crashed owner leaves a socket file but releases its lock, allowing reuse',async()=>{
 const old=process.env.XDG_RUNTIME_DIR,dir=mkdtempSync(join(tmpdir(),'buninu-stale-'));process.env.XDG_RUNTIME_DIR=dir;
 const entry=join(dir,'owner.mjs'),ready=join(dir,'ready');let child,app;
 writeFileSync(entry,`import {Compositor} from ${JSON.stringify(new URL('../lib/compositor.js',import.meta.url).href)};new Compositor({socket:${JSON.stringify(join(dir,'wayland-buninu'))}});await Bun.write(${JSON.stringify(ready)},'ready');`);
 try{
  child=Bun.spawn([process.execPath,entry],{stdout:'ignore',stderr:'inherit'});
  const deadline=Date.now()+4000;while(!existsSync(ready)){if(Date.now()>deadline||child.exitCode!==null)throw Error('Owner failed to start');await Bun.sleep(10);}
  child.kill('SIGKILL');await child.exited;
  expect(existsSync(join(dir,'wayland-buninu'))).toBe(true);
  app=await start(['--remote-debugging-port=0']);expect(app.display).toBe('wayland-buninu');
 }finally{if(child&&child.exitCode===null){child.kill();await child.exited;}app?.close();if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;}
},10000);

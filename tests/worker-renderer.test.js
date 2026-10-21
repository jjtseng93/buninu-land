import {test,expect} from 'bun:test';
import {createRenderer} from '../lib/renderer.js';
import {createWorkerRenderer} from '../lib/worker-renderer.js';
test('worker matches direct PNG for content, transforms, viewport, cursor and cached scenes',async()=>{
 const pixel=()=>({bytes:Buffer.from([0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255]),width:2,height:2,stride:8,format:1});
 const a={pixels:pixel(),scale:1,transform:0,x:0,y:0},b={pixels:pixel(),scale:1,transform:0,x:2,y:2};let visible=[a,b];
 const comp={width:8,height:8,input:{x:1,y:1},wm:{renderSurfaces:()=>visible,origin:s=>({x:s.x,y:s.y})}};
 const direct=await createRenderer(comp),worker=await createWorkerRenderer(comp);
 const compare=async options=>expect(await worker.screenshot(options)).toBe(await direct.screenshot(options));
 try{
  await compare();await compare();a.transform=1;a.x=3;await compare();
  a.viewportDestination=[4,4];await compare({maxWidth:4});
  a.pixels=pixel();a.pixels.bytes[0]=222;await compare();
  comp.deviceScaleFactor=0.6;a.fractionalScale={};await compare();
  comp.input.cursor={surface:b,x:1,y:1};await compare();
  comp.input.cursor=null;comp.input.pointer=true;await compare();
  visible=[];await compare();visible=[b,a];await compare();
  const failure=await worker.screenshot({maxWidth:0}).then(()=>null,error=>error);
  expect(failure?.message).toContain('Invalid capture limit');await compare();
  const [one,two]=await Promise.all([worker.screenshot(),worker.screenshot()]);expect(one).toBe(two);
 }finally{direct.close();worker.close();}
 await expect(worker.screenshot()).rejects.toThrow('closed');
},15000);

test('closing a renderer rejects queued captures and does not leave a worker running',async()=>{
 const comp={width:8,height:8,input:{},wm:{renderSurfaces:()=>[],origin:()=>({x:0,y:0})}};
 const worker=await createWorkerRenderer(comp);
 const a=worker.screenshot(),b=worker.screenshot();worker.close();worker.close();
 const results=await Promise.allSettled([a,b]);expect(results.map(r=>r.status)).toEqual(['rejected','rejected']);
});

import {Worker} from 'node:worker_threads';
const emptyCompositor=()=>({width:8,height:8,input:{},wm:{renderSurfaces:()=>[],origin:()=>({x:0,y:0})}});
for(const mode of ['startup-hang','startup-exit','capture-hang','capture-exit','capture-error','constructor-error'])
 test(`renderer falls back once after ${mode}, including queued captures`,async()=>{
  const comp=emptyCompositor(),warnings=[],direct=await createRenderer(comp);
  const expected=await direct.screenshot();direct.close();
  const renderer=await createWorkerRenderer(comp,{
   startupTimeout:mode==='startup-hang'?100:2000,requestTimeout:100,warn:s=>warnings.push(s),
   workerFactory:()=>{if(mode==='constructor-error')throw Error('cannot create worker');return new Worker(new URL('./fixtures/renderer-worker-failure.js',import.meta.url),{workerData:mode});},
  });
  try{
   const results=await Promise.all([renderer.screenshot(),renderer.screenshot()]);
   expect(results).toEqual([expected,expected]);expect(renderer.backend).toBe('main');
   expect(await renderer.screenshot()).toBe(expected);expect(warnings).toHaveLength(1);
  }finally{renderer.close();}
 });

test('worker bounds queued captures and close interrupts an in-flight timeout',async()=>{
 const renderer=await createWorkerRenderer(emptyCompositor(),{
  workerFactory:()=>new Worker(new URL('./fixtures/renderer-worker-failure.js',import.meta.url),{workerData:'capture-hang'}),
  requestTimeout:10000,
 });
 const requests=Array.from({length:9},()=>renderer.screenshot());
 const resultsPromise=Promise.allSettled(requests);
 await Bun.sleep(20);renderer.close();
 const results=await resultsPromise;
 expect(results.every(r=>r.status==='rejected')).toBe(true);
 expect(results[8].reason.message).toContain('queue is full');
 expect(results[0].reason.message).toContain('closed');
});

import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
test('launcher defaults to worker, with explicit CLI and environment opt-outs',async()=>{
 const keys=['XDG_RUNTIME_DIR','BUNINU_RENDER_WORKER','BUNINU_EXPERIMENT_RENDER_WORKER'];
 const old=keys.map(k=>process.env[k]),dir=mkdtempSync(join(tmpdir(),'land-render-default-'));
 process.env.XDG_RUNTIME_DIR=dir;delete process.env.BUNINU_RENDER_WORKER;delete process.env.BUNINU_EXPERIMENT_RENDER_WORKER;
 const capture=async args=>{
  const app=await start(['--remote-debugging-port=0','--window-size=8,8',...args]),labels=[];
  try{app.compositor.measure=label=>labels.push(label);await app.context.screenshot();return labels.some(s=>s.startsWith('worker:'));}
  finally{app.close();}
 };
 try{
  expect(await capture([])).toBe(true);
  process.env.BUNINU_RENDER_WORKER='1';expect(await capture(['--no-render-worker'])).toBe(false);
  process.env.BUNINU_RENDER_WORKER='0';expect(await capture([])).toBe(false);
 }finally{keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});rmSync(dir,{recursive:true,force:true});}
});

import {allocateSnapshot} from '../lib/snapshot.js';
test('shared immutable snapshots survive worker captures, replacement and failure fallback',async()=>{
 const bytes=allocateSnapshot(16);bytes.set([0,0,255,255,0,255,0,255,255,0,0,255,255,255,255,255]);
 expect(bytes.buffer instanceof SharedArrayBuffer).toBe(true);
 const s={pixels:{bytes,width:2,height:2,stride:8,format:1},scale:1,transform:0};
 const comp={width:8,height:8,fastPng:true,input:{},wm:{renderSurfaces:()=>[s],origin:()=>({x:0,y:0})}};
 const direct=await createRenderer(comp),normal=await createWorkerRenderer(comp);
 const failed=await createWorkerRenderer(comp,{warn:()=>{},workerFactory:()=>new Worker(new URL('./fixtures/renderer-worker-failure.js',import.meta.url),{workerData:'capture-exit'})});
 try{
  const before=Buffer.from(bytes),expected=await direct.screenshot();
  expect(await normal.screenshot()).toBe(expected);
  expect(await failed.screenshot()).toBe(expected);expect(failed.backend).toBe('main');
  expect(bytes).toEqual(before);expect(bytes.byteLength).toBe(16);
  const next=allocateSnapshot(16);next.fill(255);s.pixels={...s.pixels,bytes:next};
  const replacement=await normal.screenshot();expect(replacement).not.toBe(expected);
  expect(replacement).toBe(await direct.screenshot());expect(bytes).toEqual(before);
  comp.fastPng=false;expect(await normal.screenshot()).toBe(await direct.screenshot());
 }finally{direct.close();normal.close();failed.close();}
});

test('--fast-png is opt-in in both worker and main renderer launch paths',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'land-fast-png-')),old=process.env.XDG_RUNTIME_DIR;
 process.env.XDG_RUNTIME_DIR=dir;
 try{for(const extra of [[],['--no-render-worker']])for(const fast of [false,true]){
  const app=await start(['--remote-debugging-port=0','--window-size=8,8',...extra,...(fast?['--fast-png']:[])]);
  try{expect(app.compositor.fastPng).toBe(fast);const png=Buffer.from(await app.context.screenshot(),'base64');if(fast)expect(png[25]).toBe(2);}
  finally{app.close();}
 }}finally{if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;rmSync(dir,{recursive:true,force:true});}
});

import {Worker} from 'node:worker_threads';
import {createRenderer} from './renderer.js';

// A failed worker is retired permanently; the same renderer falls back to main-thread rendering.
export async function createWorkerRenderer(compositor, {
 startupTimeout=10000,requestTimeout=5000,
 workerFactory=url=>new Worker(url),fallbackFactory=createRenderer,
 warn=message=>console.error(message),
}={}) {
 let worker,closed=false,failure=null,fallbackPromise,sequence=0,nextPixel=0,known=new Set(),tail=Promise.resolve(),queued=0;
 const ids=new WeakMap(),pending=new Map();let readyResolve,readyReject;
 const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
 let startupTimer;
 const fail=error=>{
  if(failure)return;failure=error;clearTimeout(startupTimer);readyReject(error);
  for(const p of pending.values()){clearTimeout(p.timer);p.reject(error);}pending.clear();
  worker?.terminate();
 };
 const fallback=()=>{
  if(closed)return Promise.reject(Error('Renderer is closed'));
  if(!fallbackPromise){
   warn(`Renderer worker unavailable (${failure?.message}); falling back to main-thread rendering.`);
   fallbackPromise=Promise.resolve().then(()=>fallbackFactory(compositor)).then(renderer=>{
    if(closed){renderer.close();throw Error('Renderer is closed');}return renderer;
   });
  }
  return fallbackPromise;
 };
 try{
  worker=workerFactory(new URL('./renderer-worker.js',import.meta.url));
  worker.on('error',error=>fail(error));
  worker.on('exit',code=>{if(!closed)fail(Error(`Renderer worker exited (${code})`));});
  worker.on('message',data=>{
   if(closed||failure)return;
   if(data?.ready){clearTimeout(startupTimer);readyResolve();return;}
   const p=pending.get(data?.id);if(!p)return;pending.delete(data.id);clearTimeout(p.timer);
   for(const [key,ms] of data.timings??[])compositor.measure?.(`worker:${key}`,ms);
   // Bad capture options are request errors, not a failed worker.
   if(data.error){known.clear();p.reject(Error(data.error));}else p.resolve(data.result);
  });
  startupTimer=setTimeout(()=>fail(Error(`Renderer worker startup timed out (${startupTimeout} ms)`)),startupTimeout);
 }catch(error){fail(error);}
 try{await ready;}catch{await fallback();}
 return {
  get backend(){return failure?'main':'worker';},
  close(){
   if(closed)return;closed=true;fail(Error('Renderer is closed'));
   // A fallback still initializing closes itself above.
   fallbackPromise?.then(renderer=>renderer.close(),()=>{});
  },
  screenshot(options={}){
   if(closed)return Promise.reject(Error('Renderer is closed'));
   if(queued>=8)return Promise.reject(Error('Renderer screenshot queue is full'));
   queued++;
   const run=async()=>{
    if(closed)throw Error('Renderer is closed');
    if(failure)return (await fallback()).screenshot(options);
    const started=performance.now(),live=new Set(),sent=new Set(),surfaces=new Map();
    const surface=s=>{
     if(!s)return null;
     if(surfaces.has(s))return surfaces.get(s);
     let pixels=null;
     if(s.pixels){
      const b=s.pixels;let id=ids.get(b);if(!id){id=++nextPixel;ids.set(b,id);}live.add(id);
      pixels={id};
      if(!known.has(id)&&!sent.has(id)){
       pixels={id,width:b.width,height:b.height,stride:b.stride,format:b.format,bytes:b.bytes};sent.add(id);
      }
     }
     const result={pixels,origin:compositor.wm.origin(s),scale:s.scale,transform:s.transform,
      viewportSource:s.viewportSource,viewportDestination:s.viewportDestination,fractionalScale:!!s.fractionalScale};
     surfaces.set(s,result);return result;
    };
    const input=compositor.input;
    const scene={width:compositor.width,height:compositor.height,deviceScaleFactor:compositor.deviceScaleFactor,fastPng:!!compositor.fastPng,
     surfaces:[...compositor.wm.renderSurfaces()].filter(s=>s.pixels).map(surface),
     input:{pointer:!!input.pointer,x:input.x,y:input.y,cursor:input.cursor?{x:input.cursor.x,y:input.cursor.y,surface:surface(input.cursor.surface)}:null}};
    const id=++sequence;
    const result=new Promise((resolve,reject)=>{
     const timer=setTimeout(()=>fail(Error(`Renderer worker capture timed out (${requestTimeout} ms)`)),requestTimeout);
     pending.set(id,{resolve,reject,timer});
     try{worker.postMessage({id,scene,options});known=live;}
     catch(error){fail(error);}
    });
    compositor.measure?.('worker-scene-copy',performance.now()-started);
    try{return await result;}
    catch(error){
     if(closed)throw Error('Renderer is closed');
     if(failure)return (await fallback()).screenshot(options);
     throw error;
    }
   };
   const result=tail.then(run).finally(()=>queued--);tail=result.catch(()=>{});return result;
  },
 };
}

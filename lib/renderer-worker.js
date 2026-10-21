// Experimental renderer worker: CanvasKit and encoding stay off the socket thread.
import {parentPort} from 'node:worker_threads';
import {createRenderer} from './renderer.js';
import {RawFrames} from './raw-frames.js';
const pixels=new Map();let surfaces=[];
const comp={input:{},wm:{renderSurfaces:()=>surfaces,origin:s=>s.origin}};
const renderer=await createRenderer(comp,{rawFrames:new RawFrames({directory:()=>comp.rawFrameDirectory,ownsDirectory:false})});
let queue=Promise.resolve();
parentPort.on('message',data=>{
 queue=queue.then(async()=>{
  const {id,scene,options}=data,timings=[];
  try{
   comp.rawFrameDirectory=data.rawDirectory;
   const live=new Set();
   const restore=s=>{
    if(!s)return null;
    if(s.pixels){
     const p=s.pixels;live.add(p.id);
     if(p.bytes)pixels.set(p.id,p);
     s.pixels=pixels.get(p.id);if(!s.pixels)throw Error('Missing worker pixels');
    }
    return s;
   };
   surfaces=scene.surfaces.map(restore);
   comp.width=scene.width;comp.height=scene.height;comp.deviceScaleFactor=scene.deviceScaleFactor;comp.fastPng=scene.fastPng;
   comp.input=scene.input;
   if(comp.input.cursor)comp.input.cursor.surface=restore(comp.input.cursor.surface);
   for(const key of pixels.keys())if(!live.has(key))pixels.delete(key);
   comp.measure=(key,ms)=>timings.push([key,ms]);
   const result=await renderer.screenshot(options);
   parentPort.postMessage({id,result,timings});
  }catch(error){parentPort.postMessage({id,error:String(error),timings});}
 });
});
parentPort.postMessage({ready:true});

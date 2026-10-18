// Native-side experiment controller. Does not launch clients or modify a live Land.
// Run in native Termux: bun tests/dmabuf-perf.js
// POST /start {lazy:false,captureMs:33,poll:-1}; GET /stop returns timings.
import {start} from '../compositor.js';
import {join} from 'node:path';
const runtime=process.env.TMPDIR??'/tmp';
process.env.XDG_RUNTIME_DIR=runtime;
let castyClient,castyCapture,stopCasty;
let app,timer,capturing=false,stats={},captures=0,hashes=new Set(),errors=[],lastPng;
async function capture(){
 if(!app||capturing)return;capturing=true;
 try{
  const png=await app.context.screenshot({format:'png'});
  lastPng=Buffer.from(png,'base64');hashes.add(new Bun.CryptoHasher('sha256').update(lastPng).digest('hex'));captures++;
 }catch(e){errors.push(String(e));}finally{capturing=false;}
}
async function stop(){
 clearInterval(timer);
 if(castyCapture)await stopCasty(castyClient,castyCapture.cleanup);castyCapture=null;castyClient?.close();castyClient=null;
 while(capturing)await Bun.sleep(1);
 const result={stats,captures,distinctFrames:hashes.size,errors};
 if(lastPng)await Bun.write(join(runtime,'land-dmabuf-perf.png'),lastPng);
 app?.close();app=null;return result;
}
const server=Bun.serve({hostname:'127.0.0.1',port:19381,async fetch(req){
 try{
  const path=new URL(req.url).pathname;
  if(path==='/stop')return Response.json(await stop());
  if(path!=='/start'||req.method!=='POST')return new Response('POST /start or GET /stop',{status:404});
  await stop();const options=await req.json();
  delete process.env.BUNINU_EXPERIMENT_DMABUF_LAZY;
  process.env.BUNINU_RENDER_WORKER=options.worker?'1':'0';
  stats={};captures=0;hashes=new Set();errors=[];lastPng=null;
  app=await start(['--socket=wayland-dmabuf-perf','--remote-debugging-port=0','--linear-dmabuf',...(options.lazy?['--lazy-dmabuf']:[]),`--poll-interval=${options.poll??-1}`]);
  app.compositor.measure=(key,ms)=>{const s=stats[key]??={count:0,totalMs:0,maxMs:0};s.count++;s.totalMs+=ms;s.maxMs=Math.max(s.maxMs,ms);};
  if(options.casty){
   const {setupPage,startScreencast,stopScreencast}=await import('../../casty/lib/browser.js');stopCasty=stopScreencast;
   ({client:castyClient}=await setupPage({port:app.server.port},{width:800,height:600,zoom:1}));
   castyCapture=await startScreencast(castyClient,{width:800,height:600,format:options.format??'jpeg',onFrame:data=>{
    lastPng=Buffer.from(data,'base64');hashes.add(new Bun.CryptoHasher('sha256').update(lastPng).digest('hex'));captures++;
   }});
  }else timer=setInterval(capture,options.captureMs??33);
  return Response.json({socket:join(runtime,'wayland-dmabuf-perf')});
 }catch(e){return new Response(String(e),{status:500});}
}});
console.log(`Experiment controller: ${server.url}`);

// Run in Debian/proot while the native tests/dmabuf-perf.js controller is running.
// bun tests/dmabuf-benchmark.js [--repeat] [--x11]
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const root=join(tmpdir(),'land-dmabuf-experiment-'+Date.now());await mkdir(root);console.log(root);
const modes=process.argv.includes('--repeat')
 ? [['casty-both-repeat',true,true],['casty-base-repeat',false,false]]
 : [['casty-base',false,false],['casty-lazy',true,false],['casty-worker',false,true],['casty-both',true,true]];
for(const [name,lazy,worker] of modes){
 const response=await fetch('http://127.0.0.1:19381/start',{method:'POST',body:JSON.stringify({lazy,worker,casty:true})});
 if(!response.ok)throw Error(await response.text());await response.json();
 let p,output='',error='',result;
 try{
  p=Bun.spawn([process.execPath,join(import.meta.dir,'kgsl-wayland.js'),'-b','build:duration=10'],{env:{...process.env,XDG_RUNTIME_DIR:'/tmp',WAYLAND_DISPLAY:'wayland-dmabuf-perf'},stdout:'pipe',stderr:'pipe'});
  const out=new Response(p.stdout).text(),err=new Response(p.stderr).text();
  const timeout=setTimeout(()=>p.kill(),20000);try{await p.exited;}finally{clearTimeout(timeout);}
  output=await out;error=await err;
 }finally{result=await(await fetch('http://127.0.0.1:19381/stop')).json();}
 await Bun.write(join(root,name+'.json'),JSON.stringify({exitCode:p?.exitCode,...result},null,2));
 await Bun.write(join(root,name+'.log'),output+'\n'+error);
 await Bun.write(join(root,name+'.frame'),await Bun.file('/tmp/land-dmabuf-perf.png').arrayBuffer());
 console.log(name,p?.exitCode,output.match(/\[build\].*/)?.[0],`captures=${result.captures}, changing=${result.distinctFrames}, errors=${result.errors.length}`);
 if(p?.exitCode!==0||result.distinctFrames<2||result.errors.length)throw Error('Benchmark failed: inspect '+root);
}
if(process.argv.includes('--x11')){
 const p=Bun.spawn(['timeout','15','glmark2','-b','build:duration=10'],{env:{...process.env,DISPLAY:':0',MESA_LOADER_DRIVER_OVERRIDE:'kgsl',TU_DEBUG:'noconform',vblank_mode:'0'},stdout:'pipe',stderr:'pipe'});
 const out=new Response(p.stdout).text(),err=new Response(p.stderr).text();await p.exited;
 await Bun.write(join(root,'x11.log'),(await out)+'\n'+(await err));console.log('X11',p.exitCode,(await out).match(/\[build\].*/)?.[0]);
}

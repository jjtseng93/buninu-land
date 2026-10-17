// Run: BENCH_OUTPUT=/path/result.json bun bench/graphics.js
// Native Bun benchmark. Reuses installed weston-simple-shm and sibling Casty.
// Measures receipt, not terminal presentation. CPU ticks include all client work.
import { start } from '../compositor.js';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setupPage, startScreencast, stopScreencast } from '../../casty/lib/browser.js';
const seconds = Number(process.env.BENCH_SECONDS || 5);
if (!Number.isFinite(seconds) || seconds <= 0) throw Error('Invalid BENCH_SECONDS');
const hzProcess = Bun.spawn(['getconf','CLK_TCK'], {stdout:'pipe'});
const hz = Number(await new Response(hzProcess.stdout).text());
if (await hzProcess.exited || !(hz > 0)) throw Error('Cannot determine CPU tick rate');
function cpu(pid) { const s=readFileSync(`/proc/${pid}/stat`,'utf8');const f=s.slice(s.lastIndexOf(')')+2).split(' ');return (Number(f[11])+Number(f[12]))*1000/hz; }
function summary(a) { const b=[...a].sort((x,y)=>x-y);return {n:b.length,mean_ms:a.reduce((x,y)=>x+y,0)/a.length,p50_ms:b[Math.floor(b.length*.5)],p95_ms:b[Math.min(b.length-1,Math.floor(b.length*.95))]}; }
const results=[];
for (const [width,height] of [[800,600],[1280,720]]) {
  process.env.XDG_RUNTIME_DIR=mkdtempSync(join(tmpdir(),'buninu-bench-'));
  const app=await start(['--remote-debugging-port=0',`--window-size=${width},${height}`]);
  const child=Bun.spawn(['weston-simple-shm'],{env:{...process.env,WAYLAND_DISPLAY:app.display},stdout:'ignore',stderr:'ignore'});
  let client,capture;
  try {
    await Bun.sleep(1500);
    if (child.exitCode!==null || !app.compositor.frames) throw Error('Weston did not animate');
    for (const mode of ['no-capture','png','jpeg','casty-jpeg']) {
      let samples=new Map(),received=0,bytes=0,intervals=[],last=0,active=false;
      app.compositor.measure=(key,ms)=>{if(active){if(!samples.has(key))samples.set(key,[]);samples.get(key).push(ms);}};
      if(mode==='casty-jpeg') {
        ({client}=await setupPage({port:app.server.port},{width,height}));
        capture=await startScreencast(client,{width,height,format:'jpeg',quality:85,onFrame:data=>{if(active){const now=performance.now();if(last)intervals.push(now-last);last=now;received++;bytes+=data.length;}}});
        await Bun.sleep(1000);
      } else if(mode!=='no-capture') {
        for(let i=0;i<5;i++)await app.context.screenshot({format:mode,quality:85});
      }
      const frames=app.compositor.frames,clientCpu=cpu(child.pid),usage=process.cpuUsage(),begin=performance.now();active=true;
      while(performance.now()-begin < seconds*1000) {
        if(mode==='png'||mode==='jpeg'){const data=await app.context.screenshot({format:mode,quality:85});received++;bytes+=data.length;await Bun.sleep(0);}
        else await Bun.sleep(25);
      }
      active=false;
      const elapsed=performance.now()-begin,used=process.cpuUsage(usage);
      results.push({width,height,mode,elapsed_ms:elapsed,commits_per_second:(samples.get('shm-copy')?.length||0)*1000/elapsed,frame_notifications_per_second:(app.compositor.frames-frames)*1000/elapsed,received_per_second:received*1000/elapsed,base64_MB_per_second:bytes/1e6*1000/elapsed,client_cpu_ms_per_second:(cpu(child.pid)-clientCpu)*1000/elapsed,land_and_harness_cpu_ms_per_second:(used.user+used.system)/elapsed,intervals:intervals.length?summary(intervals):null,stages:Object.fromEntries([...samples].map(([k,v])=>[k,summary(v)]))});
      console.log('BENCH '+JSON.stringify(results.at(-1)));
      if(capture){await stopScreencast(client,capture.cleanup);capture=null;client.close();client=null;}
      app.compositor.measure=null;
    }
  } finally {if(capture)await stopScreencast(client,capture.cleanup);client?.close();child.kill();await child.exited;app.close();}
}
const output=process.env.BENCH_OUTPUT||join(tmpdir(),'buninu-graphics-benchmark.json');
await Bun.write(output,JSON.stringify({date:new Date().toISOString(),runtime:Bun.version,platform:process.platform,seconds,notes:['Client CPU includes drawing and Wayland work; not isolated paint time.','Land CPU includes in-process benchmark and Casty CDP receiver.','Casty receipt excludes decoding, terminal transport and physical presentation.','Direct screenshots are unpaced; no-capture does not composite.','Existing background compositor and other device workloads remain running.'],results},null,2));
console.log('RESULT '+output);

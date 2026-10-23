import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Compositor} from '../lib/compositor.js';
const flea=process.env.FLEA_BIN;
for(const family of ['ext','wlr'])test.skipIf(!flea)(`official Flea exchanges file clipboard over ${family} data-control and clears ownership`,async()=>{
 const dir=mkdtempSync(join(tmpdir(),'land-flea-clip-')),socket=join(dir,'wl');
 const comp=new Compositor({socket,clipboardHost:{read:async()=>{throw Error('no host');},write:async()=>{},close(){}}});
 if(family==='wlr')comp.globals=comp.globals.filter(g=>g[0]!=='ext_data_control_manager_v1');
 async function cli(args,input){
  const p=Bun.spawn([flea,'--clip',...args],{env:{...process.env,XDG_RUNTIME_DIR:dir,WAYLAND_DISPLAY:socket},stdin:input??'ignore',stdout:'pipe',stderr:'pipe'});
  const timer=setTimeout(()=>p.kill(9),8000);
  try{const [out,err,code]=await Promise.all([new Response(p.stdout).text(),new Response(p.stderr).text(),p.exited]);expect(err).toBe('');expect(code).toBe(0);return out.trim();}finally{clearTimeout(timer);}
 }
 try {
  for(const op of ['copy','cut']){
   const paths=['/tmp/a space.txt','/tmp/中文.txt'];
   const token=await cli(['set',op],Buffer.from(paths.join('\0')+'\0'));expect(token.length).toBeGreaterThan(0);
   const got=JSON.parse(await cli(['get']));expect(got.ok).toBe(true);expect(got.clip).toBe(op);expect(got.paths).toEqual(paths);expect(got.token).toBe(token);
   const clear=JSON.parse(await cli(['clear',token]));expect(clear.cleared).toBe(true);
   expect(JSON.parse(await cli(['get'])).clip).toBe('none');
  }
 }finally{comp.close();rmSync(dir,{recursive:true,force:true});}
},30000);

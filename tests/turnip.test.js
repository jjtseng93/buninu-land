import {test,expect} from 'bun:test';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';

// Requires an existing, working Turnip installation; never installs drivers.
test.skipIf(process.env.BUNINU_TEST_TURNIP!=='1'||!Bun.which('glmark2-wayland'))('Turnip renders changing, nonempty pixels into Land',async()=>{
 const previous=process.env.XDG_RUNTIME_DIR,runtime=mkdtempSync(join(tmpdir(),'land-turnip-'));
 process.env.XDG_RUNTIME_DIR=runtime;
 let app,child;
 try{
  app=await start(['--remote-debugging-port=0','--linear-dmabuf','--poll-interval=1']);
  child=Bun.spawn(['glmark2-wayland','-b','build:duration=3'],{env:{...process.env,WAYLAND_DISPLAY:app.display,MESA_LOADER_DRIVER_OVERRIDE:'zink',GALLIUM_DRIVER:'zink',TU_DEBUG:'noconform',MESA_VK_WSI_DEBUG:'sw'},stdout:'pipe',stderr:'pipe'});
  const output=new Response(child.stdout).text(),errors=new Response(child.stderr).text();
  const pixel=()=>app.compositor.wm.visible[0]?.surface.pixels;
  for(let i=0;i<100&&!pixel();i++)await Bun.sleep(50);
  expect(pixel()?.bytes.some(x=>x!==0)).toBe(true);
  const first=await app.context.screenshot({format:'png'});
  await Bun.sleep(250);
  const second=await app.context.screenshot({format:'png'});
  expect(second).not.toBe(first);
  await Bun.write(join(runtime,'turnip.png'),Buffer.from(second,'base64'));
  expect(await child.exited).toBe(0);
  const log=await output;expect(log).toMatch(/GL_RENDERER:.*Adreno.*Turnip/i);
  console.log(log,await errors,`Verified screenshot: ${runtime}/turnip.png`);
 }finally{
  child?.kill();if(child)await child.exited;app?.close();
  if(previous===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=previous;
 }
},15000);

import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
const dialogTest=test;
import {rgbaBitmap} from '../lib/frame.js';
const until=async fn=>{const end=Date.now()+15000;while(!await fn()){if(Date.now()>end)throw Error('Condition timed out');await Bun.sleep(10);}};
async function connect(port){
 const ws=new WebSocket(`ws://127.0.0.1:${port}/devtools/browser/cdp-server`),pending=new Map(),events=[];let id=0;
 ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}else events.push(m);};
 await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
 return {events,close:()=>ws.close(),send(method,params={}){return new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});}};
}
async function appFor(name){return start(['--remote-debugging-port=0',`--socket=desktop-${process.pid}-${name}`,'--window-size=640,480']);}
test('javascript URL uses native persistent context and setWallpaper changes actual screenshot pixels',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'land-js-'));let app,cdp;
 try{
  const path=join(dir,'green.png'),pixels=new Uint8Array(4*4*4);for(let i=0;i<pixels.length;i+=4)pixels.set([20,210,60,255],i);
  await Bun.write(path,await new Bun.Image(rgbaBitmap(pixels,4,4)).png().bytes());
  app=await appFor('wallpaper');cdp=await connect(app.server.port);
  expect(app.desktop.worker).toBeUndefined();
  await cdp.send('Page.navigate',{url:`javascript:globalThis.commandRuns=1; setWallpaper(${JSON.stringify(path)})`});
  const result=await cdp.send('Runtime.evaluate',{expression:'({version:Bun.version,count:++commandRuns})',returnByValue:true});
  expect(result.result.value.count).toBe(2);expect(result.result.value.version).toBe(Bun.version);
  await cdp.send('Page.navigate',{url:'javascript:'+encodeURIComponent('globalThis.encodedRun=42')});
  expect(await app.context.evaluate('encodedRun')).toBe(42);
  const raw=JSON.parse(await app.context.screenshot({format:'bgra'})),frame=await Bun.file(raw.path).bytes();
  expect([...frame.slice(0,4)]).toEqual([60,210,20,255]);
  expect((await cdp.send('Page.getNavigationHistory')).entries.at(-1).url).not.toStartWith('javascript:');
  await cdp.send('Page.navigate',{url:'https://example.com'});expect(await app.context.evaluate('commandRuns')).toBe(2);
 }finally{cdp?.close();app?.close();await rm(dir,{recursive:true,force:true});}
},20000);

dialogTest('native synchronous dialogs keep desktop responsive, accept typing and drive setWallpaper',async()=>{
 let app,cdp;
 try{
  app=await appFor('dialog');cdp=await connect(app.server.port);await cdp.send('Page.enable');
  const answer=cdp.send('Runtime.evaluate',{expression:"setWallpaper(prompt('Wallpaper path', 'unused'))",returnByValue:true});
  await until(()=>app.context.dialogState?.type==='prompt');
  await app.desktop.dialogs.active.ready;
  const screenshot=await app.context.screenshot({format:'png'});expect(Buffer.from(screenshot,'base64').subarray(1,4).toString()).toBe('PNG');
  // Input replaces the initially selected prompt default; Enter synchronously resumes JS.
  await cdp.send('Input.insertText',{text:'/does-not-exist.png'});
  await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'});
  expect((await answer).result.value).toBe(app.wallpaper.fallback);
  await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'});
  expect(app.desktop.active).toBe(false);
  expect(cdp.events.some(e=>e.method==='Page.javascriptDialogOpening')).toBe(true);
  expect(cdp.events.some(e=>e.method==='Page.javascriptDialogClosed')).toBe(true);
  const rejected=app.context.evaluate("confirm('Continue?')");await until(()=>app.desktop.active);
  await cdp.send('Page.handleJavaScriptDialog',{accept:false});expect(await rejected).toBe(false);
  const accepted=app.context.evaluate("confirm('Continue?')");await until(()=>app.desktop.active);
  await cdp.send('Page.handleJavaScriptDialog',{accept:true});expect(await accepted).toBe(true);
  const alert=app.context.evaluate("alert('hello'); 42");await until(()=>app.desktop.active);
  await cdp.send('Page.handleJavaScriptDialog',{accept:true});expect(await alert).toBe(42);
  expect(app.desktop.pending.size).toBe(0);
  const previous=app.wallpaper.current;
  const cancelled=app.context.evaluate("setWallpaper(prompt('Cancel wallpaper'))");await until(()=>app.desktop.active);
  await cdp.send('Page.handleJavaScriptDialog',{accept:false});expect(await cancelled).toBeNull();
  expect(app.wallpaper.current).toBe(previous);
 }finally{cdp?.close();app?.close();}
},30000);

dialogTest('closing desktop during a synchronous prompt terminates its worker and releases pending requests',async()=>{
 const app=await appFor('close');
 try{
  const pending=app.context.evaluate("prompt('close test')").catch(e=>e.message);
  await until(()=>app.desktop.active);const worker=app.desktop.worker;
  const exited=new Promise(resolve=>worker.once('exit',resolve));
  app.close();expect(await pending).toContain('Desktop closed');await exited;
  expect(app.desktop.worker).toBeNull();expect(app.desktop.pending.size).toBe(0);expect(app.desktop.dialogs.active).toBeNull();
 }finally{app.close();}
},30000);

dialogTest('repeated native evaluations and modal lifetimes do not retain requests or workers',async()=>{
 const app=await appFor('lifetime');
 try{
  const evaluate=source=>app.context.evaluate(source);
  // Warm the evaluator, then measure collected live heap, not RSS high-water marks.
  for(let i=0;i<100;i++)await evaluate('(()=>{const transient=new Uint8Array(65536);return transient.byteLength})()');
  const before=await evaluate('Bun.gc(true); process.memoryUsage()');
  const worker=app.desktop.worker;
  for(let i=0;i<500;i++){
    expect(await evaluate('(()=>{const transient=new Uint8Array(65536);return transient.byteLength})()')).toBe(65536);
  }
  const after=await evaluate('Bun.gc(true); process.memoryUsage()');
  expect(app.desktop.worker).toBe(worker);expect(app.desktop.pending.size).toBe(0);
  expect(after.heapUsed-before.heapUsed).toBeLessThan(8*1024*1024);
  expect(after.external-before.external).toBeLessThan(8*1024*1024);
  const displays=[];
  for(let i=0;i<12;i++){
    const answer=evaluate("confirm('repeat')");await until(()=>app.desktop.active);
    const entry=app.desktop.dialogs.active;await entry.ready;displays.push(app.desktop.dialogs);
    app.context.handleDialog({accept:i%2===0});expect(await answer).toBe(i%2===0);
    expect(app.desktop.dialogs.active).toBeNull();expect(app.desktop.pending.size).toBe(0);
  }
  expect(new Set(displays).size).toBe(1);
  expect(app.desktop.dialogs.surface).toBeNull();
  expect(app.desktop.dialogs.paragraph).toBeNull();
  const exited=new Promise(resolve=>worker.once('exit',resolve));app.close();await exited;
  expect(app.desktop.dialogs.fonts).toBeNull();
  expect(app.desktop.pending.size).toBe(0);expect(app.desktop.worker).toBeNull();
 }finally{app.close();}
},60000);

test('native worker exit rejects callers and a new command gets a fresh context',async()=>{
 const app=await appFor('restart');
 try{
  for(let i=0;i<3;i++){
   expect(await app.context.evaluate('typeof Bun')).toBe('object');
   const worker=app.desktop.worker,exited=new Promise(resolve=>worker.once('exit',resolve));
   await expect(app.context.evaluate('process.exit(0)')).rejects.toThrow('worker exited');await exited;
   expect(app.desktop.worker).toBeNull();expect(app.desktop.pending.size).toBe(0);
  }
  expect(await app.context.evaluate('1+2')).toBe(3);
 }finally{app.close();}
},20000);

dialogTest('long modal text scrolls and copies through the existing host clipboard',async()=>{
 const app=await appFor('scroll');let written='';
 try{
  app.compositor.clipboard.host.write=async text=>{written=text;};
  const answer=app.context.evaluate(`alert(${JSON.stringify(Array.from({length:100},(_,i)=>'Line '+i).join('\n'))})`);
  await until(()=>app.desktop.active);const entry=app.desktop.dialogs.active;await entry.ready;
  const ui=app.desktop.dialogs,g=ui.geometry;
  expect(ui.paragraph.getHeight()).toBeGreaterThan(g.mh);
  await app.context.dispatchMouseEvent({type:'mouseWheel',x:g.mx+20,y:g.my+20,deltaY:150,deltaX:0});
  expect(entry.scroll).toBeGreaterThan(0);
  await app.context.dispatchKeyEvent({type:'keyDown',key:'a',code:'KeyA',modifiers:2});
  await app.context.dispatchKeyEvent({type:'keyUp',key:'a',code:'KeyA',modifiers:2});
  await app.context.dispatchKeyEvent({type:'keyDown',key:'c',code:'KeyC',modifiers:2});
  expect(written).toContain('Line 0');expect(written).toContain('Line 99');
  await app.context.dispatchKeyEvent({type:'keyUp',key:'c',code:'KeyC',modifiers:2});
  await app.context.dispatchKeyEvent({type:'keyDown',key:'Escape',code:'Escape'});await answer;
  await app.context.dispatchKeyEvent({type:'char',key:'Escape',code:'Escape'});
  await app.context.dispatchKeyEvent({type:'keyUp',key:'Escape',code:'Escape'});
  expect(app.compositor.input.pressed.size).toBe(0);
 }finally{app.close();}
},20000);

(await Bun.file(new URL('../../casty/lib/click.js',import.meta.url)).exists()?test:test.skip)('Casty marker and real pointer click can close a synchronous alert at fractional scale',async()=>{
 const {dispatchClick}=await import('../../casty/lib/click.js');
 const app=await appFor('casty-click');let cdp;
 try{
  app.context.resize(720,836,1.0947802197802199);
  cdp=await connect(app.server.port);await cdp.send('Page.enable');
  const client={send:(...args)=>cdp.send(...args)};
  const displays=[];
  for(let i=0;i<3;i++){
   const answer=cdp.send('Page.navigate',{url:`javascript:alert('Click ${i}')`});await until(()=>app.desktop.active);
   const ui=app.desktop.dialogs;await ui.active.ready;
   const button=ui.buttons.find(b=>b.accept);displays.push(ui);
   // Cosmetic DOM markers reject immediately; real pointer phases still work.
   await dispatchClick(client,button.x+button.width/2,button.y+button.height/2);await answer;
   expect(app.desktop.active).toBe(false);expect(app.desktop.pending.size).toBe(0);
  }
  expect(new Set(displays).size).toBe(1);
 }finally{cdp?.close();app.close();}
},20000);

test('Land-owned prompt uses no browser host, keeps long input visible and releases UI resources',async()=>{
 const app=await appFor('own-ui');let writes='';
 try{
  app.compositor.clipboard.host.read=async()=> 'host clipboard';
  app.compositor.clipboard.host.write=async text=>{writes=text;};
  const answer=app.context.evaluate("prompt('中文訊息：test selection', 'default')");
  answer.catch(()=>{});
  await until(()=>app.desktop.active);const ui=app.desktop.dialogs,entry=ui.active;await entry.ready;
  expect(entry.host).toBeUndefined();expect(app.desktop.dialogPool).toBeUndefined();
  expect(ui.surface.pixels.bytes.length).toBe(ui.surface.pixels.width*ui.surface.pixels.height*4);
  await expect(app.context.evaluate('document.body')).rejects.toThrow('no page DOM');
  const press=async(key,modifiers=0)=>{await app.context.dispatchKeyEvent({type:'keyDown',key,code:key,modifiers});await app.context.dispatchKeyEvent({type:'keyUp',key,code:key,modifiers});};
  await press('v',2);expect(entry.value).toBe('host clipboard');
  await app.context.type(' '.repeat(3)+'a'.repeat(200));
  expect(entry.inputScroll).toBeGreaterThan(0);
  await press('Home');expect(entry.inputScroll).toBe(0);
  await press('ArrowRight',8);await press('c',2);expect(writes).toBe('h');
  await press('End');await press('Backspace');expect(entry.value.endsWith('a'.repeat(199))).toBe(true);
  // Resize a visible modal, then expose its buttons even in a very short viewport.
  await app.context.resize(320,120,1.25);expect(ui.surface.pixels.width).toBe(400);
  await app.context.dispatchMouseEvent({type:'mouseWheel',x:100,y:80,deltaY:500,deltaX:0});
  const b=ui.buttons.find(b=>b.accept);expect(b.y+b.height).toBeLessThanOrEqual(120);
  await app.context.dispatchMouseEvent({type:'mousePressed',button:'left',x:b.x+2,y:b.y+2});
  await app.context.dispatchMouseEvent({type:'mouseReleased',button:'left',x:b.x+2,y:b.y+2});
  expect(await answer).toStartWith('host clipboard');
  expect(ui.surface).toBeNull();expect(ui.paragraph).toBeNull();expect(entry.timer).toBeNull();
 }finally{app.close();}
},20000);

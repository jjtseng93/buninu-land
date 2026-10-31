import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
import {dialogModuleUrl} from '../lib/desktop.js';
const dialogTest=(await dialogModuleUrl())?test:test.skip;
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
  const pids=[];
  for(let i=0;i<12;i++){
    const answer=evaluate("confirm('repeat')");await until(()=>app.desktop.active);
    const entry=app.desktop.dialogs.active;await entry.ready;pids.push(entry.host.pid);
    app.context.handleDialog({accept:i%2===0});expect(await answer).toBe(i%2===0);
    expect(app.desktop.dialogs.active).toBeNull();expect(app.desktop.pending.size).toBe(0);
  }
  await until(async()=>{
    for(const pid of pids){try{const stat=await Bun.file(`/proc/${pid}/stat`).text();if(!/^\d+ \(.*\) Z /.test(stat))return false;}catch{}}
    return true;
  });
  console.log('desktop collected heap before/after bytes:',before,after,'completed dialog renderers:',pids.length);
  const exited=new Promise(resolve=>worker.once('exit',resolve));app.close();await exited;
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
  const state=()=>entry.host.call('evaluate',"({top:document.getElementById('message').scrollTop,height:document.getElementById('message').clientHeight,total:document.getElementById('message').scrollHeight})");
  expect((await state()).total).toBeGreaterThan((await state()).height);
  const rect=await entry.host.call('evaluate',"document.getElementById('message').getBoundingClientRect().toJSON()");
  await app.context.dispatchMouseEvent({type:'mouseWheel',x:rect.x+20,y:rect.y+20,deltaY:150,deltaX:0});
  expect((await state()).top).toBeGreaterThan(0);
  await entry.host.call('evaluate',"(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById('message'));const s=getSelection();s.removeAllRanges();s.addRange(r);})()");
  await app.context.dispatchKeyEvent({type:'keyDown',key:'c',code:'KeyC',modifiers:2});
  expect(written).toContain('Line 0');expect(written).toContain('Line 99');
  await app.context.dispatchKeyEvent({type:'keyUp',key:'c',code:'KeyC',modifiers:2});
  await app.context.dispatchKeyEvent({type:'keyDown',key:'Escape',code:'Escape'});await answer;
  await app.context.dispatchKeyEvent({type:'char',key:'Escape',code:'Escape'});
  await app.context.dispatchKeyEvent({type:'keyUp',key:'Escape',code:'Escape'});
  expect(app.compositor.input.pressed.size).toBe(0);
 }finally{app.close();}
},20000);

import {test,expect} from 'bun:test';
import {mkdtempSync,mkdirSync,openSync,closeSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';
const waitFor=async(predicate,child)=>{const until=Date.now()+25000;while(Date.now()<until){if(child.exitCode!==null)throw Error(`Browser exited ${child.exitCode}`);if(predicate())return;await Bun.sleep(30);}throw Error('Browser did not reach expected state');};
// Explicit opt-in: these spawn full browser process trees. No downloads/install.
for(const kind of ['chromium','firefox'])test.skipIf(!process.env.BUNINU_TEST_BROWSERS||!Bun.which(kind))(`${kind}: real Wayland SHM page, keyboard and pointer`,async()=>{
  const old=process.env.XDG_RUNTIME_DIR,dir=mkdtempSync(join(tmpdir(),`buninu-${kind}-test-`));process.env.XDG_RUNTIME_DIR=dir;
  let app,child,ws;const log=openSync(join(dir,'browser.log'),'w');
  try{
    mkdirSync(join(dir,'profile'));
    writeFileSync(join(dir,'profile/user.js'),'user_pref("browser.shell.checkDefaultBrowser",false);\nuser_pref("browser.startup.homepage_override.mstone","ignore");\nuser_pref("datareporting.policy.dataSubmissionPolicyBypassNotification",true);\n');
    writeFileSync(join(dir,'page.html'),`<!doctype html><title>Ready</title><style>body{background:#153;color:white;min-height:4000px;min-width:4000px}input{font-size:24px}button{position:fixed;left:40px;top:160px;width:140px;height:70px;background:#ff00ff;border:0}</style><h1>Buninu browser input test</h1><input id="text" autofocus oninput="document.title='typed:'+this.value"><button onclick="document.title='clicked:'+document.getElementById('text').value">Click</button><script>onscroll=()=>document.title="scroll:"+Math.round(scrollX)+","+Math.round(scrollY)</script>`);
    app=await start(['--remote-debugging-port=0','--window-size=1000,700']);
    const noSandbox=process.env.BUNINU_TEST_CHROMIUM_NO_SANDBOX==='1';
    const cmd=kind==='chromium'?[Bun.which(kind),...(noSandbox?['--no-sandbox']:[]),'--ozone-platform=wayland','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--user-data-dir='+join(dir,'profile')]:[Bun.which(kind),'--no-remote','--profile',join(dir,'profile')];
    cmd.push('file://'+join(dir,'page.html'));
    child=Bun.spawn(cmd,{env:{...process.env,WAYLAND_DISPLAY:'wayland-buninu',MOZ_ENABLE_WAYLAND:'1',GDK_BACKEND:'wayland'},stdout:log,stderr:log,detached:true});
    const windows=()=>app.compositor.wm.visible;
    await waitFor(()=>windows().some(w=>w.surface.xdg.toplevel.title?.includes('Ready')),child);
    app.context.type('wayland');
    await waitFor(()=>windows().some(w=>w.surface.xdg.toplevel.title?.includes('typed:wayland')),child);
    // Find the real page button's magenta pixels, accounting for window decorations.
    let point;
    await waitFor(()=>{
      for(const s of app.compositor.wm.renderSurfaces()){
        const b=s.pixels;if(!b)continue;let minX=b.width,minY=b.height,maxX=-1,maxY=-1;
        for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++){const i=y*b.stride+x*4;if(b.bytes[i]===255&&b.bytes[i+1]===0&&b.bytes[i+2]===255){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}}
        if(maxX-minX>50&&maxY-minY>30){const o=app.compositor.wm.origin(s);point={x:o.x+(minX+maxX)/2/s.scale,y:o.y+(minY+maxY)/2/s.scale};return true;}
      }return false;
    },child);
    for(const type of ['mousePressed','mouseReleased'])app.context.dispatchMouseEvent({type,...point,button:'left'});
    await waitFor(()=>windows().some(w=>w.surface.xdg.toplevel.title?.includes('clicked:wayland')),child);
    expect(app.compositor.frames).toBeGreaterThan(0);
    expect(windows().some(w=>w.surface.xdg.toplevel.title.includes('clicked:wayland'))).toBe(true);
    // Exercise the same CDP mouseWheel request Casty sends, then observe actual DOM scrolling.
    ws=new WebSocket(`ws://127.0.0.1:${app.server.port}/devtools/browser/cdp-server`);
    await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
    let id=0;const pending=new Map();
    ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}};
    const wheel=(deltaX,deltaY)=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method:'Input.dispatchMouseEvent',params:{type:'mouseWheel',x:500,y:400,deltaX,deltaY}}));});
    const scroll=()=>{const title=windows()[0]?.surface.xdg.toplevel.title??'';const match=/^scroll:(\d+),(\d+)/.exec(title);return match?match.slice(1).map(Number):[0,0];};
    await wheel(0,100);await waitFor(()=>scroll()[1]>0,child);
    expect(scroll()[1]).toBeGreaterThan(0);
    await wheel(0,-100);await waitFor(()=>scroll()[1]===0,child);
    await wheel(100,0);await waitFor(()=>scroll()[0]>0,child);
    expect(scroll()[0]).toBeGreaterThan(0);
    await wheel(-100,0);await waitFor(()=>scroll()[0]===0,child);
    await Bun.write(join(dir,'screen.png'),Buffer.from(await app.context.screenshot(),'base64'));
    console.log(`${kind} verified screenshot and log: ${dir}`);
  }finally{
    ws?.close();
    if(child){try{process.kill(-child.pid,'SIGTERM');}catch{}child.kill();await Promise.race([child.exited,Bun.sleep(2000)]);if(child.exitCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}child.kill('SIGKILL');}}
    app?.close();closeSync(log);if(old===undefined)delete process.env.XDG_RUNTIME_DIR;else process.env.XDG_RUNTIME_DIR=old;
  }
},60000);

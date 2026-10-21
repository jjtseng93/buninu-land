import {negotiateCapture} from './capture-format.js';
import {mkdirSync,mkdtempSync,rmSync,openSync,closeSync,writeFileSync} from 'node:fs';
mkdirSync('/tmp/cdp-format-probe',{recursive:true});
const results={};
function rpc(url){return new Promise((resolve,reject)=>{
 const ws=new WebSocket(url),pending=new Map();let id=0;
 const start=setTimeout(()=>{ws.close();reject(Error('WebSocket timeout'));},8000);
 ws.onerror=()=>{clearTimeout(start);reject(Error('WebSocket connection failed'));};
 ws.onmessage=e=>{const data=JSON.parse(e.data);const p=pending.get(data.id);if(p){pending.delete(data.id);clearTimeout(p.timer);p.resolve(data);}};
 ws.onopen=()=>{clearTimeout(start);resolve({close:()=>ws.close(),send:(method,params={})=>new Promise(resolve=>{
   const n=++id;const timer=setTimeout(()=>{pending.delete(n);resolve({timeout:true,method});},10000);
   pending.set(n,{resolve,timer});ws.send(JSON.stringify({id:n,method,params}));
 })});};
});}
function brief(r){const copy=structuredClone(r);if(copy.result?.data){const b=Buffer.from(copy.result.data,'base64');copy.result={...copy.result,data:`[${b.length} bytes; prefix ${b.subarray(0,12).toString('hex')}]`};}return copy;}
for(const kind of (process.env.PROBE_BROWSER ? [process.env.PROBE_BROWSER] : ['chromium','firefox'])){
 const server=Bun.serve({port:0,fetch:()=>new Response()});const port=server.port;server.stop(true);
 const profile=mkdtempSync('/tmp/cdp-format-probe/'+kind+'-'),log='/tmp/cdp-format-probe/'+kind+'.log',fd=openSync(log,'w');
 const args=kind==='chromium'?['chromium-headless-shell','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--user-data-dir='+profile,'--remote-debugging-port='+port,'about:blank']:['firefox','--headless','--no-remote','--profile',profile,'--remote-debugging-port='+port,'about:blank'];
 const child=Bun.spawn(args,{stdout:fd,stderr:fd,env:{...process.env,MOZ_DISABLE_CONTENT_SANDBOX:'1',MOZ_DISABLE_RDD_SANDBOX:'1'}});
 let client;
 try{
  let ready=false;
  for(let n=0;n<100;n++){try{await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(500)});ready=true;break;}catch{}await Bun.sleep(150);}
  if(!ready)throw Error('Browser debugging listener did not start: '+log);
  const out=results[kind]={version:Bun.spawnSync([kind==='chromium'?'chromium-headless-shell':'firefox','--version']).stdout.toString().trim()};
  if(kind==='chromium'){
   const targets=await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();client=await rpc(targets.find(t=>t.type==='page').webSocketDebuggerUrl);
   out.browserVersion=await client.send('Browser.getVersion');
   out.negotiation={};
   const adapter={async send(method,params){const r=await client.send(method,params);if(r.error)throw Error(r.error.message);return r.result;}};
   for(const configured of ['auto','png','jpeg','webp']){
    const selection=await negotiateCapture(adapter,{configured,transport:'file',queryPreference:async()=> 'bgra'});
    out.negotiation[configured]={...selection,capture:brief(await client.send('Page.captureScreenshot',{format:selection.format}))};
   }
   out.captures={};for(const format of ['png','bgra','rgba','png'])out.captures[format==='png'&&out.captures.png?'pngAfter':format]=brief(await client.send('Page.captureScreenshot',{format}));
  }else{
   out.http={};for(const path of ['/json/version','/json/list']){const r=await fetch(`http://127.0.0.1:${port}${path}`);out.http[path]={status:r.status,body:(await r.text()).slice(0,250)};}
   client=await rpc(`ws://127.0.0.1:${port}/session`);
   out.session=await client.send('session.new',{capabilities:{alwaysMatch:{acceptInsecureCerts:false}}});
   out.cdp={};for(const format of ['png','bgra','rgba'])out.cdp[format]=brief(await client.send('Page.captureScreenshot',{format}));
   const created=await client.send('browsingContext.create',{type:'tab'});out.created=created;const context=created.result?.context;
   if(context){out.navigation=await client.send('browsingContext.navigate',{context,url:'data:text/html,<body style=background:red>format probe</body>',wait:'complete'});}
   if(context){out.bidi={};for(const type of ['image/png','bgra','rgba','image/png'])out.bidi[type==='image/png'&&out.bidi[type]?'pngAfter':type]=brief(await client.send('browsingContext.captureScreenshot',{context,format:{type}}));}
   await client.send('session.end');
  }
 }catch(e){results[kind]={...results[kind],error:String(e)};}
 finally{
  client?.close();child.kill('SIGTERM');await Promise.race([child.exited,Bun.sleep(2000)]);
  if(child.exitCode===null){child.kill('SIGKILL');await child.exited;}closeSync(fd);rmSync(profile,{recursive:true,force:true});
 }
 writeFileSync('/tmp/cdp-format-probe/results.json',JSON.stringify(results,null,2));
 console.log(kind,JSON.stringify(results[kind]));
}

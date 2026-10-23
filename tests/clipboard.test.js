import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,writeSync,readSync,closeSync,openSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Compositor} from '../lib/compositor.js';
import {libc} from '../lib/transport.js';
import {clipboardBackends,HostClipboard} from '../lib/clipboard-host.js';
import {interfaces} from '../lib/protocol.js';
const unavailable={read:async()=>{throw Error('none');},write:async()=>{},close(){}};
async function fixture(run,host=unavailable){
 const dir=mkdtempSync(join(tmpdir(),'land-clipboard-')),comp=new Compositor({socket:join(dir,'wl'),clipboardHost:host}),sockets=[];
 async function client(){const old=new Set(comp.clients);sockets.push(await Bun.connect({unix:join(dir,'wl'),socket:{data(){},error(){},close(){}}}));for(let i=0;i<100;i++){const c=[...comp.clients].find(c=>!old.has(c));if(c)return c;await Bun.sleep(5);}throw Error('No client');}
 try{await run(comp,client,dir);}finally{for(const s of sockets)s.end();comp.close();rmSync(dir,{recursive:true,force:true});}
}
function device(c,family='ext_data_control',version=1){const manager=c.add(2,family==='wl_data'?'wl_data_device_manager':family+'_manager_v1',version);c.add(3,'wl_seat');c.request(manager,'get_data_device',[4,3]);return c.object(4);}
function source(c,types){c.request(c.object(2),'create_data_source',[5]);for(const mime of types)c.request(c.object(5),'offer',[mime]);return c.object(5);}
const latest=c=>[...c.objects.values()].filter(o=>o.clipboardSource).at(-1);

test('both data-control XMLs expose correct versions and fd receive signatures',()=>{
 expect(interfaces.get('ext_data_control_manager_v1').version).toBe('1');
 expect(interfaces.get('zwlr_data_control_manager_v1').version).toBe('2');
 expect(interfaces.get('ext_data_control_offer_v1').requests[0].args.map(a=>a.type)).toEqual(['string','fd']);
});

test('MIME offers cross ext, wlr and focused core devices; FD transfer, cancellation and disconnect',async()=>fixture(async(comp,connect,dir)=>{
 const a=await connect(),b=await connect(),c=await connect();
 const da=device(a),db=device(b,'zwlr_data_control',2),dc=device(c,'wl_data');
 comp.input.keyboard={client:c};comp.clipboard.focus(c);
 const src=source(a,['text/uri-list','x-special/gnome-copied-files']);a.request(da,'set_selection',[src.id]);
 expect(latest(b).clipboardSource).toBe(src);expect(latest(c).clipboardSource).toBe(src);
 const sent=[],original=a.event.bind(a);a.event=(o,n,...args)=>{sent.push([n,...args]);if(n==='send')writeSync(args[1],Buffer.from('copy\nfile:///tmp/example'));else original(o,n,...args);};
 const fd=openSync(join(dir,'received'),'w+');b.request(latest(b),'receive',['x-special/gnome-copied-files',libc.dup(fd)]);
 const data=Buffer.alloc(100);expect(readSync(fd,data,0,100,0)).toBe(24);expect(data.subarray(0,24).toString()).toBe('copy\nfile:///tmp/example');closeSync(fd);
 // Hyprland tolerates reused sources and late offers instead of disconnecting.
 a.request(da,'set_selection',[src.id]);a.request(src,'offer',['text/plain']);
 expect(comp.clipboard.selection).toBe(src);expect(src.mimes.has('text/plain')).toBe(true);
 b.request(db,'set_selection',[0]);expect(comp.clipboard.selection).toBeNull();expect(sent.some(e=>e[0]==='cancelled')).toBe(true);
 // Primary selection is separate and available to data-control clients.
 const sb=source(b,['application/test']);b.request(db,'set_primary_selection',[sb.id]);expect(comp.clipboard.primary).toBe(sb);expect(comp.clipboard.selection).toBeNull();
 b.connection.close();expect(comp.clipboard.primary).toBeNull();
}));

test('a failing receiver is disconnected without failing the selection owner',async()=>fixture(async(comp,connect)=>{
 const a=await connect(),b=await connect(),da=device(a);device(b);
 b.add=()=>{throw Error('Invalid new object ID');};
 const src=source(a,['application/test']);a.request(da,'set_selection',[src.id]);
 expect(comp.clipboard.selection).toBe(src);expect(comp.clients.has(b)).toBe(false);expect(comp.clients.has(a)).toBe(true);
}));

test('owner disconnect during delivery stops the stale broadcast',async()=>fixture(async(comp,connect)=>{
 const a=await connect(),b=await connect(),da=device(a),db=device(b),events=[],original=b.event.bind(b);
 b.event=(o,n,...args)=>{if(o===db)events.push([n,...args]);original(o,n,...args);};
 const src=source(a,['application/test']);a.add=()=>{throw Error('Invalid new object ID');};
 events.length=0;a.request(da,'set_selection',[src.id]);
 expect(comp.clipboard.selection).toBeNull();expect(events.at(-1)[0]).toBe('selection');expect(latest(b).clipboardSource).toBe(comp.clipboard.hostSource);
}));

test('core selection follows Hyprland: no focus or serial check',async()=>fixture(async(comp,connect)=>{
 const c=await connect(),d=device(c,'wl_data'),s=source(c,['application/test']);
 c.request(d,'set_selection',[s.id,7]);expect(comp.clipboard.selection).toBe(s);
 c.destroy(s);expect(comp.clipboard.selection).toBeNull();
}));

test('core start_drag validates surfaces and cancels the source without changing selection',async()=>fixture(async(comp,connect)=>{
 const c=await connect(),d=device(c,'wl_data'),s=source(c,['text/plain']),sent=[],original=c.event.bind(c);
 c.event=(o,n,...a)=>{sent.push([o,n]);original(o,n,...a);};
 expect(()=>c.request(d,'start_drag',[s.id,9,0,1])).toThrow('Invalid object 9');
 const wc=c.add(8,'wl_compositor',4);c.request(wc,'create_surface',[9]);c.request(wc,'create_surface',[10]);
 expect(()=>c.request(d,'start_drag',[s.id,9,11,1])).toThrow('Invalid object 11');
 c.request(d,'start_drag',[s.id,9,10,1]);expect(sent).toContainEqual([s,'cancelled']);
 c.request(d,'start_drag',[0,9,0,1]);expect(comp.clipboard.selection).toBeNull();
}));

test('host import stays refreshable; idle, focus and empty replies preserve file selection',async()=>{
 let text='host 中文\n',reads=0;const host={...unavailable,read:async()=>{reads++;return text;}};
 await fixture(async(comp,connect,dir)=>{
  const c=await connect(),d=device(c);
  comp.clipboard.focus(c);await Bun.sleep(50);
  expect(reads).toBe(0);expect(comp.clipboard.selection).toBeNull();
  expect(await comp.clipboard.importHost()).toBe(true);expect(reads).toBe(1);
  const offer=latest(c);expect(offer.clipboardSource.bytes.toString()).toBe(text);
  text='host changed after import';
  const fd=openSync(join(dir,'host-text'),'w+');c.request(offer,'receive',['text/plain',libc.dup(fd)]);await Bun.sleep(10);
  expect(readFileSync(join(dir,'host-text'),'utf8')).toBe(text);closeSync(fd);expect(reads).toBe(2);
  const s=source(c,['text/uri-list']);c.request(d,'set_selection',[s.id]);
  comp.clipboard.focus(c);text='';await Bun.sleep(50);
  expect(reads).toBe(2);expect(comp.clipboard.selection).toBe(s);
  expect(await comp.clipboard.importHost()).toBe(false);expect(comp.clipboard.selection).toBe(s);
 },host);
});

test('text export reads owner pipe asynchronously and failed host write retains Wayland selection',async()=>{
 const writes=[];const host={...unavailable,write:async text=>{writes.push(text);throw Error('offline');}};
 await fixture(async(comp,connect)=>{
  const c=await connect(),d=device(c),s=source(c,['text/plain']);const original=c.event.bind(c);
  c.event=(o,n,...a)=>{if(n==='send')writeSync(a[1],Buffer.from('exact 中文\n'));else original(o,n,...a);};
  c.request(d,'set_selection',[s.id]);await comp.clipboard.exports;expect(writes).toEqual(['exact 中文\n']);expect(comp.clipboard.selection).toBe(s);
 },host);
});

test('empty owner text is neither exported nor cached',async()=>{
 const writes=[];const host={...unavailable,write:async text=>{writes.push(text);}};
 await fixture(async(comp,connect)=>{
  const c=await connect(),d=device(c),s=source(c,['text/plain']);const original=c.event.bind(c);
  c.event=(o,n,...a)=>{if(n!=='send')original(o,n,...a);};
  c.request(d,'set_selection',[s.id]);await comp.clipboard.exports;expect(writes).toEqual([]);expect(comp.clipboard.selection).toBe(s);
  expect(comp.clipboard.textCache).toBeNull();c.destroy(s);expect(comp.clipboard.selection).toBeNull();
 },host);
});

test('xclip is first on Windows too; no self-referential wl clipboard; fallback preserves bytes',async()=>{
 const which=n=>'/bin/'+n;
 expect(clipboardBackends({platform:'win32',which}).map(b=>b.name)).toEqual(['xclip','powershell']);
 expect(clipboardBackends({platform:'linux',which,socket:'/tmp/ours',env:{WAYLAND_DISPLAY:'ours',XDG_RUNTIME_DIR:'/tmp'}}).map(b=>b.name)).toEqual(['xclip','xsel','termux']);
 expect(clipboardBackends({platform:'linux',which,socket:'/tmp/ours',env:{WAYLAND_DISPLAY:'parent',XDG_RUNTIME_DIR:'/tmp'}}).map(b=>b.name)).toEqual(['xclip','wl-clipboard','xsel','termux']);
 const calls=[];const host=new HostClipboard({platform:'linux',which,env:{},spawn:(args,options)=>{calls.push([args,options]);return {exited:Promise.resolve(args[0].endsWith('xclip')?1:0),kill(){}};}});
 await host.write('中文\n');expect(calls.map(c=>c[0][0])).toEqual(['/bin/xclip','/bin/xsel']);expect(calls[1][1].stdin.toString()).toBe('中文\n');host.close();
});

test('PowerShell adapter preserves jsmdcui literal quoting and exactly one output newline',async()=>{
 const {powershellClipboard}=await import('../lib/clipboard-powershell.js');
 const original=Bun.spawnSync,calls=[];
 try{Bun.spawnSync=(args,options)=>{calls.push(args);return {success:true,stdout:Buffer.from('one\r\n\r\n')};};
 const backend=powershellClipboard('powershell.exe');expect(backend.read()).toBe('one\r\n');expect(backend.write("a'b\n$literal")).toBe(true);
 expect(calls).toEqual([['powershell.exe','-NoProfile','-Command','Get-Clipboard -Raw'],['powershell.exe','-NoProfile','-Command',"Set-Clipboard 'a''b\n$literal'"]]);
 }finally{Bun.spawnSync=original;}
});

test('copied text survives owner close; explicit paste reads host once and falls back to cache',async()=>{
 let hostText=null,reads=0;
 const host={...unavailable,write:async()=>{throw Error('background');},read:async()=>{reads++;if(hostText===null)throw Error('background');return hostText;}};
 await fixture(async(comp,connect,dir)=>{
  const a=await connect(),b=await connect(),da=device(a);device(b);
  const s=source(a,['text/plain']),original=a.event.bind(a);
  a.event=(o,n,...args)=>{if(n==='send')writeSync(args[1],Buffer.from('saved 中文'));else original(o,n,...args);};
  a.request(da,'set_selection',[s.id]);await comp.clipboard.exports;
  a.connection.close();
  expect(comp.clipboard.selection.cachedText).toBe(true);
  expect(comp.clipboard.textCache.owner).toBeNull();
  comp.clipboard.focus(b);await Bun.sleep(30);expect(reads).toBe(0);
  let count=0;
  const paste=async()=>{
   const path=join(dir,'paste-'+count++),fd=openSync(path,'w+');
   try{b.request(latest(b),'receive',['text/plain',libc.dup(fd)]);for(let i=0;i<100&&!readFileSync(path).length;i++)await Bun.sleep(5);return readFileSync(path,'utf8');}finally{closeSync(fd);}
  };
  expect(await paste()).toBe('saved 中文');expect(reads).toBe(1);
  hostText='';expect(await paste()).toBe('saved 中文');expect(reads).toBe(2);
  hostText='fresh host';expect(await paste()).toBe('fresh host');expect(reads).toBe(3);
  hostText=null;expect(await paste()).toBe('fresh host');expect(reads).toBe(4);
 },host);
});


test('fresh clipboard offers host text without cache and reads only on receive',async()=>{
 let reads=0,text='external first copy';
 const host={...unavailable,read:async()=>{reads++;if(text===null)throw Error('denied');return text;}};
 await fixture(async(comp,connect,dir)=>{
  const c=await connect();device(c,'wl_data');
  comp.input.keyboard={client:c};comp.clipboard.focus(c);
  expect(comp.clipboard.textCache).toBeNull();expect(reads).toBe(0);
  expect(latest(c).clipboardSource).toBe(comp.clipboard.hostSource);
  let count=0;
  const paste=async()=>{
   const path=join(dir,'fresh-'+count++),fd=openSync(path,'w+');
   try{
    c.request(latest(c),'receive',['text/plain',libc.dup(fd)]);
    for(let i=0;i<100&&comp.clipboard.tasks.size;i++)await Bun.sleep(5);
    await Bun.sleep(10);
    return readFileSync(path,'utf8');
   }finally{closeSync(fd);}
  };
  text=null;expect(await paste()).toBe('');expect(reads).toBe(1);
  text='external first copy';expect(await paste()).toBe(text);expect(reads).toBe(2);
  expect(comp.clipboard.textCache.bytes.toString()).toBe(text);
  text=null;expect(await paste()).toBe('external first copy');expect(reads).toBe(3);
  text='new external copy';expect(await paste()).toBe(text);expect(reads).toBe(4);
 },host);
});

test('pending host read cannot override a new live owner',async()=>{
 let complete;const host={...unavailable,read:()=>new Promise(r=>complete=r)};
 await fixture(async(comp,connect,dir)=>{
  const c=await connect(),d=device(c),fd=openSync(join(dir,'race'),'w+');
  c.request(latest(c),'receive',['text/plain',libc.dup(fd)]);
  const s=source(c,['text/uri-list']);c.request(d,'set_selection',[s.id]);
  complete('stale host');await Bun.sleep(10);
  expect(comp.clipboard.selection).toBe(s);expect(comp.clipboard.textCache).toBeNull();
  expect(readFileSync(join(dir,'race'),'utf8')).toBe('');closeSync(fd);
 },host);
});


test('live text owner receives fresh host text; denial falls back and file MIME stays direct',async()=>{
 let hostText='new host',reads=0;
 const host={...unavailable,read:async()=>{reads++;if(hostText===null)throw Error('denied');return hostText;}};
 await fixture(async(comp,connect,dir)=>{
  const a=await connect(),b=await connect(),da=device(a);device(b);
  const s=source(a,['text/plain']),original=a.event.bind(a);
  a.event=(o,n,...args)=>{if(n==='send')writeSync(args[1],Buffer.from('old owner'));else original(o,n,...args);};
  a.request(da,'set_selection',[s.id]);await comp.clipboard.exports;
  const paste=async (name,mime='text/plain')=>{
   const path=join(dir,name),fd=openSync(path,'w+');
   try{b.request(latest(b),'receive',[mime,libc.dup(fd)]);for(let i=0;i<100&&!readFileSync(path).length;i++)await Bun.sleep(5);return readFileSync(path,'utf8');}finally{closeSync(fd);}
  };
  expect(reads).toBe(0);
  expect(await paste('fresh')).toBe('new host');expect(reads).toBe(1);
  hostText=null;expect(await paste('denied')).toBe('old owner');expect(reads).toBe(2);
  // Route by requested MIME, even when the same owner offers files and text.
  a.request(s,'offer',['text/uri-list']);hostText='unrelated host';
  expect(await paste('file','text/uri-list')).toBe('old owner');expect(reads).toBe(2);
  expect(await paste('mixed-text')).toBe('unrelated host');expect(reads).toBe(3);
 },host);
});

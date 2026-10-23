import {libc,errno} from './transport.js';
import {HostClipboard,MAX_TEXT} from './clipboard-host.js';

const TEXT = ['text/plain;charset=utf-8','text/plain','UTF8_STRING'];
const control = iface => iface.startsWith('ext_data_control_') || iface.startsWith('zwlr_data_control_');
const kind = iface => iface.startsWith('ext_')?'ext_data_control':iface.startsWith('zwlr_')?'zwlr_data_control':'wl_data';

// Only host bridging reads bytes here. Client-to-client transfer passes the
// receiver's fd straight to the owner: no buffering, encoding or MIME conversion.
export class Clipboard {
  constructor(comp,{host, socket}={}) {
    this.comp=comp;this.host=host??new HostClipboard({socket});this.devices=new Set();
    this.selection=null;this.primary=null;this.tasks=new Set();this.generation=0;
    this.closed=false;this.textCache=null;
    // Offer host text even before the first copy; read only on receive.
    this.hostSource={mimes:new Set(TEXT),bytes:Buffer.alloc(0),cachedText:true};
  }
  live(source){return source && (!source.client || source.client.objects.get(source.id)===source);}
  offeredSource(primary=false){return primary?this.primary:(this.selection??this.hostSource);}
  register(device) {
    this.devices.add(device);
    this.send(device,false);
    if(control(device.iface))this.send(device,true);
  }
  send(device,primary=false) {
    if(this.closed || (primary && (!control(device.iface) || device.iface.startsWith('zwlr_')&&device.version<2)))return;
    if(!control(device.iface)&&this.comp.input.keyboard?.client!==device.client)return;
    const source=this.offeredSource(primary),client=device.client;
    const event=primary?'primary_selection':'selection';
    if(!this.live(source)){client.event(device,event,0);return;}
    let id=0xff000000;while(client.objects.has(id))id++;
    const iface=kind(device.iface)==='wl_data'?'wl_data_offer':kind(device.iface)+'_offer_v1';
    const offer=client.add(id,iface,1,{clipboardSource:source,clipboardPrimary:primary},true);
    client.event(device,'data_offer',offer.id);
    for(const mime of source.mimes)client.event(offer,'offer',mime);
    client.event(device,event,offer.id);
  }
  // A failure while offering to one receiver must not become a protocol error
  // for the client whose request changed the selection: drop only the receiver.
  deliver(device,primary=false) {
    try {this.send(device,primary);}
    catch(e) {console.error(`Wayland client: ${e.message}`);device.client.connection.close();}
  }
  focus(client) {for(const d of [...this.devices])if(this.devices.has(d)&&d.client===client&&!control(d.iface))this.deliver(d);}
  set(source,primary=false,fromHost=false) {
    const key=primary?'primary':'selection',old=this[key];
    if(old===source)return;
    this[key]=source;
    if(old?.client&&this.live(old))old.client.event(old,'cancelled');
    if(!primary)this.generation++;
    for(const d of [...this.devices]) {
      // A receiver disconnect can destroy this source and publish a newer selection.
      if(this[key]!==source)return;
      if(this.devices.has(d))this.deliver(d,primary);
    }
    if(source&&!primary&&!fromHost)void this.exportHost(source);
  }
  destroyed(object) {
    this.devices.delete(object);
    if(this.selection===object){
      const saved=this.textCache?.owner===object?this.cachedSource():null;
      if(saved)this.textCache.owner=null;
      this.set(saved,false,true);
    }
    if(this.primary===object)this.set(null,true);
  }
  request(client,o,name,a) {
    const family=kind(o.iface),isControl=control(o.iface);
    if(!isControl&&!['wl_data_device_manager','wl_data_device','wl_data_source','wl_data_offer'].includes(o.iface))return false;
    if(name==='destroy'||name==='release'){client.destroy(o);return true;}
    if(name==='create_data_source') {
      client.add(a[0],family==='wl_data'?'wl_data_source':family+'_source_v1',1,{mimes:new Set(),used:false});return true;
    }
    if(name==='get_data_device') {
      client.object(a[1],'wl_seat');
      const device=client.add(a[0],family==='wl_data'?'wl_data_device':family+'_device_v1',o.version);
      this.register(device);return true;
    }
    if(name==='offer') {o.mimes.add(a[0]);return true;}
    if(name==='set_selection'||name==='set_primary_selection') {
      const source=a[0]?client.object(a[0],family==='wl_data'?'wl_data_source':family+'_source_v1'):null;
      // Like Hyprland's DataDevice.cpp, core selections check neither focus nor serial.
      // Hyprland also only warns on reused sources and late offers: Firefox et al. rely on them.
      if(source?.used&&process.env.BUNINU_LOG)console.error('Clipboard: selection set from a used source');
      if(source)source.used=true;
      this.set(source,name==='set_primary_selection');return true;
    }
    if(name==='receive') {
      const [mime,fd]=a,source=o.clipboardSource;
      if(!this.live(source)||source!==this.offeredSource(o.clipboardPrimary)||!source.mimes.has(mime)){libc.close(fd);return true;}
      if(source.client) {
        try {source.client.event(source,'send',mime,fd);} finally {libc.close(fd);}
      } else if(source.cachedText)void this.pasteCached(fd,source);
      else void this.writeFD(fd,source.bytes);
      return true;
    }
    if(name==='accept') {
      const source=o.clipboardSource;
      if(this.live(source)&&source.iface==='wl_data_source')source.client.event(source,'target',source.mimes.has(a[1])?a[1]:null);
      return true;
    }
    // Clipboard support does not advertise drag-and-drop implementation.
    if(name==='start_drag') {
      client.object(a[1],'wl_surface');if(a[2])client.object(a[2],'wl_surface');
      if(a[0])client.event(client.object(a[0],'wl_data_source'),'cancelled');return true;
    }
    return false;
  }
  task(fd) {
    const task={fd,closed:false};this.tasks.add(task);
    task.close=()=>{if(task.closed)return;task.closed=true;libc.close(fd);this.tasks.delete(task);};
    return task;
  }
  async writeFD(fd,bytes) {
    const task=this.task(fd),deadline=Date.now()+3000;
    try {
      const flags=libc.fcntl(fd,3,0);if(flags<0||libc.fcntl(fd,4,flags|0x800)<0)return;
      for(let offset=0;offset<bytes.length&&!task.closed;) {
        const part=bytes.subarray(offset),n=Number(libc.write(fd,part,part.length));
        if(n>0){offset+=n;continue;}
        if(n===0||![4,11].includes(errno())||Date.now()>deadline)return;
        await Bun.sleep(4);
      }
    } finally {task.close();}
  }
  async readSource(source,mime) {
    const fds=new Int32Array(2);
    if(libc.pipe2(fds,0x80000|0x800)<0)throw Error('Clipboard pipe failed');
    // Only our read end is nonblocking; the owner can write normally.
    libc.fcntl(fds[1],4,libc.fcntl(fds[1],3,0)&~0x800);
    const task=this.task(fds[0]),chunks=[],buffer=Buffer.alloc(65536),deadline=Date.now()+2000;let size=0;
    try {
      try{source.client.event(source,'send',mime,fds[1]);}finally{libc.close(fds[1]);}
      while(!task.closed&&this.selection===source) {
        const n=Number(libc.read(task.fd,buffer,buffer.length));
        if(n===0)return Buffer.concat(chunks).toString('utf8');
        if(n>0){size+=n;if(size>MAX_TEXT)throw Error('Clipboard too large');chunks.push(Buffer.from(buffer.subarray(0,n)));continue;}
        if(![4,11].includes(errno())||Date.now()>deadline)break;
        await Bun.sleep(4);
      }
      throw Error('Clipboard read cancelled or timed out');
    } finally{task.close();}
  }
  async exportHost(source) {
    const mime=TEXT.find(m=>source.mimes.has(m));if(!mime)return;
    const generation=this.generation;
    // Serialize host writes, so an older slow owner cannot overwrite a newer one.
    this.exports=(this.exports??Promise.resolve()).then(async()=>{
      if(this.closed||generation!==this.generation)return;
      try {
        const text=await this.readSource(source,mime);
        if(this.closed||generation!==this.generation)return;
        if(!text)return;
        this.rememberText(text,source);
        await this.host.write(text);
      } catch {}
    });
    await this.exports;
  }
  rememberText(text,owner=null) {
    if(typeof text!=='string'||Buffer.byteLength(text)>MAX_TEXT)return;
    this.textCache={bytes:Buffer.from(text),owner};
  }
  cachedSource() {
    return this.textCache?{mimes:new Set(TEXT),bytes:this.textCache.bytes,cachedText:true}:null;
  }
  // Advertise without reading the host, even in a fresh session with no cache.
  // Each receive, including from unfocused data-control clients, reads the
  // host once, not only user paste gestures; denied/empty reads retain
  // the last copied text. File MIME offers never enter this path.
  async pasteCached(fd,source) {
    const generation=this.generation;
    let bytes=this.textCache?.bytes??source.bytes;
    try {
      const text=await this.host.read();
      if(typeof text==='string'&&text.length&&Buffer.byteLength(text)<=MAX_TEXT){
        bytes=Buffer.from(text);
        if(!this.closed&&this.generation===generation&&this.offeredSource()===source){this.rememberText(text);source.bytes=bytes;}
      }
    }catch{}
    if(this.closed||this.generation!==generation||this.offeredSource()!==source){libc.close(fd);return;}
    await this.writeFD(fd,bytes);
  }

  // Explicit one-shot host import, not wired to a frontend paste action yet.
  // Do not call it from device registration, focus changes or a timer. The only
  // other host read is pasteCached(): any receive of the host/cache fallback,
  // including unfocused data-control clients. A live owner's paste never reads it.
  async importHost() {
    if(this.closed)return false;
    const generation=this.generation;
    try {
      const text=await this.host.read();
      if(this.closed||generation!==this.generation||!text)return false;
      this.rememberText(text);
      this.set({mimes:new Set(TEXT),bytes:Buffer.from(text)},false,true);
      return true;
    } catch {
      if(!this.closed&&generation===this.generation&&!this.live(this.selection)&&this.textCache){
        this.set(this.cachedSource(),false,true);return true;
      }
      return false;
    }
  }
  close(){this.closed=true;this.host.close?.();for(const task of this.tasks)task.close();this.textCache=null;}
}

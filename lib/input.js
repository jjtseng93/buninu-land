import { mkdtempSync, openSync, writeFileSync, closeSync, unlinkSync, rmdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Keymap, xkbModifiers } from './keymap.js';
const time = () => Math.floor(performance.now()) >>> 0;
const buttons = { left:272, right:273, middle:274, back:275, forward:276 };
const modifier = key => ({Shift:8,Control:2,Alt:1,Meta:4}[key] ?? 0);
export class Input {
  constructor(comp, socket) {
    this.comp=comp; this.directory=dirname(socket); this.keymap=new Keymap();
    this.keyboard=null;this.pointer=null;this.pressed=new Map();this.buttons=new Set();
    this.x=0;this.y=0;this.mods=0;this.locked=0;this.physicalMods=0;
  }
  resources(surface, iface) { return surface ? [...surface.client.objects.values()].filter(o=>o.iface===iface) : []; }
  emit(surface, iface, name, ...args) {for(const r of this.resources(surface,iface))r.client.event(r,name,...args);}
  keymapTo(r) {
    if(r.keymapVersion===this.keymap.version)return;
    const dir=mkdtempSync(join(this.directory,'.buninu-keymap-')),file=join(dir,'keymap');let fd;
    try {
      fd=openSync(file,'wx+',0o600);const bytes=Buffer.from(this.keymap.text());writeFileSync(fd,bytes);
      r.client.event(r,'keymap',1,fd,bytes.length);r.keymapVersion=this.keymap.version;
    } finally {if(fd!==undefined)closeSync(fd);try{unlinkSync(file);}finally{rmdirSync(dir);}}
  }
  register(r) {
    if(r.iface==='wl_keyboard') {
      this.keymapTo(r);if(r.version>=4)r.client.event(r,'repeat_info',25,600);
      if(this.keyboard?.client===r.client){r.client.event(r,'enter',this.comp.serial++,this.keyboard.id,this.held());r.client.event(r,'modifiers',this.comp.serial++,this.mods,0,this.locked,0);}
    } else if(this.pointer?.client===r.client) {
      const o=this.comp.wm.origin(this.pointer);r.client.event(r,'enter',this.enterSerial=this.comp.serial++,this.pointer.id,this.x-o.x,this.y-o.y);this.frame();
    }
  }
  held() {const keys=[...this.pressed.values()].filter(v=>!v.consumed).map(v=>v.item.evdev),b=Buffer.alloc(keys.length*4);keys.forEach((v,i)=>b.writeUInt32LE(v,i*4));return b;}
  modifiers(bits) {this.mods=xkbModifiers(bits);this.emit(this.keyboard,'wl_keyboard','modifiers',this.comp.serial++,this.mods,0,this.locked,0);}
  focus(s) {
    if(this.keyboard===s)return;
    if(this.keyboard){this.emit(this.keyboard,'wl_keyboard','modifiers',this.comp.serial++,0,0,this.locked,0);this.emit(this.keyboard,'wl_keyboard','leave',this.comp.serial++,this.keyboard.id);}
    this.keyboard=s;
    if(s)this.emit(s,'wl_data_device','selection',0);
    if(s){this.emit(s,'wl_keyboard','enter',this.comp.serial++,s.id,this.held());this.emit(s,'wl_keyboard','modifiers',this.comp.serial++,this.mods,0,this.locked,0);}
  }
  key(p) {
    const key=p.key??p.text??'',id=p.code||key,up=p.type==='keyUp';
    if(p.type==='char'){if(!this.pressed.size)this.type(p.text??key);return;}
    if(!up&&!['rawKeyDown','keyDown'].includes(p.type))return;
    if(up){
      const held=this.pressed.get(id);this.pressed.delete(id);this.physicalMods&=~modifier(key);
      if(held&&!held.consumed)this.emit(this.keyboard,'wl_keyboard','key',this.comp.serial++,time(),held.item.evdev,0);
      this.modifiers(this.physicalMods);return;
    }
    if(this.pressed.has(id))return; // client repeat_info handles a held key
    this.physicalMods|=modifier(key);
    const mods=(p.modifiers??0)|this.physicalMods;
    if(key==='Escape'&&this.dismissPopups()){this.pressed.set(id,{consumed:true});return;}
    if(this.comp.wm.shortcut(key,mods)){this.pressed.set(id,{consumed:true});return;}
    const item=this.keymap.resolve(key,p.code);if(!item)return;
    for(const c of this.comp.clients)for(const r of c.objects.values())if(r.iface==='wl_keyboard')this.keymapTo(r);
    if(key==='CapsLock')this.locked^=2;
    this.modifiers(mods|(item.shift?8:0));this.pressed.set(id,{item});
    this.emit(this.keyboard,'wl_keyboard','key',this.comp.serial++,time(),item.evdev,1);
  }
  type(text) {for(const key of String(text).replace(/\r\n/g,'\n')){this.key({type:'keyDown',key});this.key({type:'keyUp',key});}}
  pointerFocus(s) {
    if(this.pointer===s)return;
    if(this.pointer)this.emit(this.pointer,'wl_pointer','leave',this.comp.serial++,this.pointer.id);
    this.pointer=s;this.cursor=null;
    if(s){const o=this.comp.wm.origin(s);this.emit(s,'wl_pointer','enter',this.enterSerial=this.comp.serial++,s.id,this.x-o.x,this.y-o.y);}
  }
  frame() {for(const c of this.comp.clients)for(const r of c.objects.values())if(r.iface==='wl_pointer'&&r.version>=5)r.client.event(r,'frame');}
  setCursor(r,serial,s,x,y) {
    if(this.pointer?.client!==r.client||serial!==this.enterSerial)return;
    if(s&&(s.xdg||s.role&&s.role!=='cursor'))throw Error('Cursor surface already has another role');
    if(s)s.role='cursor';this.cursor={surface:s,x,y};this.comp.onFrame?.();
  }
  top(s) {while(s?.popup||s?.subsurface?.parent)s=s.popup?s.popup.parent.surface:s.subsurface.parent;return s?.window;}
  dismissPopups() {
    let any=false;
    for(const s of [...this.comp.surfaces].reverse())if(s.popup&&!s.popup.dismissed){s.popup.dismissed=true;s.client.event(s.popup,'popup_done');any=true;}
    if(any){this.popupGrab=null;this.focus(this.comp.wm.focused?.surface??null);this.pointerFocus(null);this.comp.onFrame?.();}return any;
  }
  beginDrag(w,serial,edges=0) {
    if(!w||!this.buttons.size||this.lastButtonSerial!==serial||this.top(this.pointer)!==w)return;
    if(edges&&![1,2,4,5,6,8,9,10].includes(edges))throw Error('Invalid resize edge');
    if(w.fullscreen)return;
    if(!w.floating){this.comp.wm.detach(w);w.floating=true;this.comp.wm.layout();}
    this.drag={window:w,resize:!!edges,edges,box:{...w.box},x:this.x,y:this.y};this.comp.wm.configure(w);
  }
  mouse(p) {
    if(!Number.isFinite(p.x)||!Number.isFinite(p.y))return;
    this.x=p.x;this.y=p.y;
    if(this.drag&&p.type==='mouseMoved') {
      const d=this.drag,b={...d.box},dx=this.x-d.x,dy=this.y-d.y;
      if(!d.resize){b.x+=dx;b.y+=dy;}else {
        const top=d.window.surface.xdg.toplevel,min=top.minSize??[80,60],max=top.maxSize??[0,0];
        const width=Math.max(min[0]||1,Math.min(max[0]||8192,b.width+((d.edges&4)?-dx:(d.edges&8)?dx:0)));
        const height=Math.max(min[1]||1,Math.min(max[1]||8192,b.height+((d.edges&1)?-dy:(d.edges&2)?dy:0)));
        if(d.edges&4)b.x+=b.width-width;if(d.edges&1)b.y+=b.height-height;b.width=width;b.height=height;
      }
      d.window.box=b;this.comp.wm.configure(d.window);this.comp.onFrame?.();return;
    }
    const hit=this.comp.wm.hit(this.x,this.y);
    if(!this.buttons.size)this.pointerFocus(hit?.surface??null);
    const s=this.pointer;
    if(s){const o=this.comp.wm.origin(s);this.emit(s,'wl_pointer','motion',time(),this.x-o.x,this.y-o.y);}
    if(p.type==='mousePressed') {
      if(this.popupGrab&&!hit?.surface.popup){this.dismissPopups();this.frame();return;}
      const button=buttons[p.button];if(!button||this.buttons.has(button))return;
      const w=this.top(s);if(w)this.comp.wm.focus(w);
      this.buttons.add(button);this.lastButtonSerial=this.comp.serial++;
      this.emit(s,'wl_pointer','button',this.lastButtonSerial,time(),button,1);
      if((p.modifiers&4)&&w)this.beginDrag(w,this.lastButtonSerial,p.button==='right'?10:0);
    }else if(p.type==='mouseReleased'){
      const button=buttons[p.button];if(!this.buttons.delete(button))return;
      this.emit(s,'wl_pointer','button',this.comp.serial++,time(),button,0);
      if(!this.buttons.size){if(this.drag){const w=this.drag.window;this.drag=null;this.comp.wm.configure(w);}this.pointerFocus(hit?.surface??null);}
    }else if(p.type==='mouseWheel'&&s){
      for(const r of this.resources(s,'wl_pointer')){if(r.version>=5)r.client.event(r,'axis_source',0);
        if(p.deltaY)r.client.event(r,'axis',time(),0,p.deltaY/10);if(p.deltaX)r.client.event(r,'axis',time(),1,p.deltaX/10);}
    }
    this.frame();this.comp.onFrame?.();
  }
  removed(s) {if(this.pointer===s){this.pointerFocus(null);this.buttons.clear();}if(this.keyboard===s)this.focus(null);if(this.cursor?.surface===s)this.cursor=null;if(this.drag?.window.surface===s)this.drag=null;if(this.popupGrab?.surface===s)this.popupGrab=null;}
}

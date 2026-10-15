// Dwindle-style binary splits, focus/raise, and floating geometry modeled after
// Hyprland's DwindleAlgorithm, FocusState, and default floating algorithm.
// This is a JS subset; see THIRD_PARTY_NOTICES.md for attribution and limits.
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
export class WindowManager {
  constructor(comp) { this.comp=comp; this.windows=[]; this.roots=new Map(); this.workspace=1; this.focused=null; this.gap=8; }
  get visible() { return this.windows.filter(w=>w.workspace===this.workspace && w.surface.pixels); }
  changed() { this.comp.onFrame?.(); }
  add(surface) {
    if(surface.window) return surface.window;
    const w={surface,workspace:this.workspace,floating:false,fullscreen:false,box:{x:8,y:8,width:Math.max(1,this.comp.width-16),height:Math.max(1,this.comp.height-16)}};
    surface.window=w; this.windows.push(w); this.insert(w); this.layout(); return w;
  }
  insert(w) {
    const root=this.roots.get(w.workspace), leaf={window:w,parent:null}; w.node=leaf;
    if(!root) {this.roots.set(w.workspace,leaf);return;}
    let target=this.focused?.workspace===w.workspace&&!this.focused.floating?this.focused.node:null;
    if(!target) {target=root;while(target.children)target=target.children[0];}
    const parent=target.parent;
    const branch={parent,children:[target,leaf],ratio:0.5,vertical:target.window.box.height>target.window.box.width};
    target.parent=branch;leaf.parent=branch;
    if(parent)parent.children[parent.children.indexOf(target)]=branch;else this.roots.set(w.workspace,branch);
  }
  detach(w) {
    const node=w.node;if(!node)return;
    const p=node.parent;
    if(!p)this.roots.delete(w.workspace);
    else {const other=p.children.find(n=>n!==node),gp=p.parent;other.parent=gp;if(gp)gp.children[gp.children.indexOf(p)]=other;else this.roots.set(w.workspace,other);}
    w.node=null;
  }
  remove(surface) {
    const w=surface.window;if(!w)return;
    this.detach(w);this.windows=this.windows.filter(x=>x!==w);surface.window=null;
    if(this.focused===w){this.focused=null;this.comp.input?.focus(null);this.focus(this.visible.at(-1));}
    this.layout();
  }
  focus(w) {
    if(w && (w.workspace!==this.workspace || !w.surface.pixels))return;
    const old=this.focused;
    this.focused=w??null;
    if(w){this.windows=this.windows.filter(x=>x!==w);this.windows.push(w);}
    this.comp.input?.focus(w?.surface??null);
    if(old&&old!==w)this.configure(old);
    if(w&&old!==w)this.configure(w);
    this.changed();
  }
  configure(w) {
    const s=w.surface,x=s.xdg;
    if(!x?.toplevel||!s.client.objects.has(x.id))return;
    const states=[];
    if(w.fullscreen)states.push(2);else if(w.maximized)states.push(1);
    if(this.focused===w)states.push(4);
    if(this.comp.input?.drag?.window===w&&this.comp.input.drag.resize)states.push(3);
    const width=Math.max(1,Math.round(w.box.width)),height=Math.max(1,Math.round(w.box.height));
    const signature=[width,height,...states].join(',');
    if(x.configureSerial&&x.lastConfiguration===signature)return;
    x.lastConfiguration=signature;
    const array=Buffer.alloc(states.length*4);states.forEach((v,i)=>array.writeUInt32LE(v,i*4));
    s.client.event(x.toplevel,'configure',width,height,array);
    const serial=this.comp.serial++;x.configureSerial=serial;(x.configures??=[]).push(serial);
    s.client.event(x,'configure',serial);
  }
  layout() {
    const root=this.roots.get(this.workspace),g=this.gap;
    const arrange=(node,box)=>{
      if(node.window){node.window.box=box;return;}
      const extent=node.vertical?box.height:box.width,first=Math.max(1,Math.floor((extent-g)*node.ratio)),second=Math.max(1,extent-g-first);
      arrange(node.children[0],{...box,[node.vertical?'height':'width']:first});
      arrange(node.children[1],{...box,[node.vertical?'y':'x']:(node.vertical?box.y:box.x)+first+g,[node.vertical?'height':'width']:second});
    };
    if(root)arrange(root,{x:g,y:g,width:Math.max(1,this.comp.width-2*g),height:Math.max(1,this.comp.height-2*g)});
    for(const w of this.windows)if(w.workspace===this.workspace){
      if(w.fullscreen||w.maximized)w.box={x:0,y:0,width:this.comp.width,height:this.comp.height};
      this.configure(w);
    }
    this.changed();
  }
  toggleFloating(w=this.focused) {
    if(!w)return;
    if(w.fullscreen||w.maximized)this.fullscreen(w,false);
    if(w.floating){w.floating=false;this.insert(w);}
    else {this.detach(w);w.floating=true;w.box={x:Math.round(this.comp.width*.15),y:Math.round(this.comp.height*.15),width:Math.round(this.comp.width*.7),height:Math.round(this.comp.height*.7)};}
    this.layout();
  }
  fullscreen(w=this.focused,enabled=!w?.fullscreen,maximized=false) {
    if(!w)return;
    if(enabled&&!w.fullscreen&&!w.maximized)w.restoreBox={...w.box};
    w.fullscreen=enabled&&!maximized;w.maximized=enabled&&maximized;
    if(!enabled&&w.floating&&w.restoreBox)w.box=w.restoreBox;
    this.layout();
  }
  cycle(back=false) {const a=this.visible;if(!a.length)return;const i=a.indexOf(this.focused);this.focus(a[(i+(back?-1:1)+a.length)%a.length]);}
  direction(dx,dy,swap=false) {
    const w=this.focused;if(!w)return;const a=w.fullscreen?(w.restoreBox??w.box):w.box,cx=a.x+a.width/2,cy=a.y+a.height/2;
    const candidates=this.visible.filter(v=>v!==w).map(v=>{const b=v.box;return {v,x:b.x+b.width/2-cx,y:b.y+b.height/2-cy};})
      .filter(v=>dx?v.x*dx>0:v.y*dy>0).sort((a,b)=>Math.hypot(a.x,a.y)-Math.hypot(b.x,b.y));
    const other=candidates[0]?.v;if(!other)return;
    if(swap&&w.node&&other.node){const n=w.node;w.node=other.node;other.node=n;w.node.window=w;other.node.window=other;this.layout();}
    else {const full=w.fullscreen;if(full)this.fullscreen(w,false);this.focus(other);if(full)this.fullscreen(other,true);}
  }
  adjust(dx,dy,resize=false) {
    const w=this.focused;if(!w)return;
    if(w.floating){
      if(resize){w.box.width=clamp(w.box.width+dx,80,8192);w.box.height=clamp(w.box.height+dy,60,8192);}
      else {w.box.x=clamp(w.box.x+dx,-w.box.width+40,this.comp.width-40);w.box.y=clamp(w.box.y+dy,0,this.comp.height-30);}
      this.configure(w);this.changed();
    } else if(resize){let n=w.node;while(n?.parent){const p=n.parent;if((dx&&!p.vertical)||(dy&&p.vertical)){p.ratio=clamp(p.ratio+(dx||dy)/500,.1,.9);this.layout();break;}n=p;}}
  }
  switchWorkspace(n,move=false) {
    if(n<1||n>9)return;
    const w=this.focused;
    if(move&&w){this.detach(w);w.workspace=n;if(!w.floating)this.insert(w);}
    this.workspace=n;this.focused=null;this.comp.input?.focus(null);this.layout();this.focus(this.visible.at(-1));this.comp.input?.pointerFocus(null);
  }
  shortcut(key,mods) {
    // Omarchy's Super+arrows/W/F, with Super replaced by Ctrl+Alt.
    // Match modifiers exactly so app shortcuts with extra modifiers pass through.
    if(mods!==3)return false;
    const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if(dirs[key]){this.direction(...dirs[key]);return true;}
    if(key.toLowerCase()==='w'){this.close();return true;}
    if(key.toLowerCase()==='f'){this.fullscreen();return true;}
    return false;
  }
  close(w=this.focused) {if(w)w.surface.client.event(w.surface.xdg.toplevel,'close');}
  // Surface origin excludes xdg window geometry's client-side shadow margins.
  origin(s) {
    if(s.popup){const p=this.origin(s.popup.parent.surface),g=s.popup.parent.surface.geometry??[0,0];return {x:p.x+g[0]+s.popup.box.x,y:p.y+g[1]+s.popup.box.y};}
    const box=s.window?.box??{x:0,y:0};const g=s.geometry??[0,0];return{x:box.x-g[0],y:box.y-g[1]};
  }
  renderSurfaces() {
    const visible=this.visible,full=visible.findLast(w=>w.fullscreen);
    const windows=full?[full]:[...visible.filter(w=>!w.floating),...visible.filter(w=>w.floating)];
    const result=[];const children=s=>{result.push(s);for(const p of this.comp.surfaces)if(p.popup?.parent.surface===s&&p.pixels&&!p.popup.dismissed)children(p);};
    for(const w of windows)children(w.surface);return result;
  }
  hit(x,y) {
    for(const s of this.renderSurfaces().reverse()){
      const o=this.origin(s),b=s.pixels,rot=s.transform&1,w=(rot?b.height:b.width)/s.scale,h=(rot?b.width:b.height)/s.scale,lx=x-o.x,ly=y-o.y;
      if(lx<0||ly<0||lx>=w||ly>=h)continue;
      if(s.inputRegion){let inside=false;for(const {add,rect:r} of s.inputRegion)if(lx>=r[0]&&ly>=r[1]&&lx<r[0]+r[2]&&ly<r[1]+r[3])inside=add;if(!inside)continue;}
      return {surface:s,x:lx,y:ly};
    }return null;
  }
}

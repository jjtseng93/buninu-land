import {dirname,join} from 'node:path';
// Land-owned modal UI. Only Skia text/raster primitives are loaded, never a
// browser, DOM, stylesheet engine, media decoder or renderer subprocess.
let kitPromise;
async function kit() {
  return kitPromise??=import('../vendor/canvaskit/canvaskit.js').then(async({default:init})=>init({wasmBinary:await Bun.file(new URL('../vendor/canvaskit/canvaskit.wasm',import.meta.url)).arrayBuffer()})).catch(error=>{kitPromise=null;throw error;});
}
// Optional installed CJK fonts are assets only; no browser code is imported.
async function fontData(){
  const bytes=[await Bun.file(new URL('../vendor/fonts/DejaVuSansMono.ttf',import.meta.url)).arrayBuffer()];
  const paths=['/system/fonts/NotoSansCJK-Regular.ttc','/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'];
  for(const base of [import.meta.dir,process.cwd()])try{paths.push(join(dirname(Bun.resolveSync('buninu-browser/package.json',base)),'usr/share/fonts/NotoSansCJK-Regular.ttc'));}catch{}
  paths.push(new URL('../../buninu-browser/usr/share/fonts/NotoSansCJK-Regular.ttc',import.meta.url));
  for(const path of paths)if(await Bun.file(path).exists()){bytes.push(await Bun.file(path).arrayBuffer());break;}
  return bytes;
}
export class DesktopDialog {
  constructor(options){Object.assign(this,options);this.active=null;this.surface=null;this.closedUI=false;}
  open(request){
    if(this.closedUI||this.active)return Promise.resolve({accept:false});
    const answer=Promise.withResolvers(),entry={request,answer,scroll:0,start:0,end:0,value:String(request.defaultPrompt??'').replace(/[\r\n]/g,''),focus:request.type==='prompt'?'input':'message'};
    if(entry.focus==='input')entry.end=entry.value.length;
    this.active=entry;
    entry.ready=this.initialize(entry).catch(error=>{console.error('buninu-land: dialog:',error.message);this.finish({accept:false},entry);});
    this.opened(request);return answer.promise;
  }
  async initialize(entry){
    this.initialized??=Promise.all([kit(),fontData()]).then(([K,fonts])=>{
      if(this.closedUI)return;
      this.CK=K;this.fonts=K.FontMgr.FromData(...fonts);
      if(!this.fonts)throw Error('Cannot load dialog fonts');
    });
    await this.initialized;if(this.closedUI||this.active!==entry)return;
    this.paint();
    if(entry.request.type==='prompt'){entry.timer=setInterval(()=>{if(this.active===entry){entry.caretOff=!entry.caretOff;this.paint();}},500);entry.timer.unref?.();}
  }
  layout(){
    const {width:w,height:h,deviceScaleFactor:dpr=1}=this.viewport();
    const panelTop=Math.min(48,h/12),x=Math.min(12,w/4),width=Math.max(1,Math.min(480,w-2*x)),left=(w-width)/2,top=panelTop-(this.active?.panelScroll??0),pad=Math.min(20,width/8);
    const inner=Math.max(1,width-2*pad),messageHeight=Math.max(18,Math.min(this.paragraph?.getHeight()??20,h-panelTop-160));
    return {w,h,dpr,x:left,y:top,width,pad,inner,mx:left+pad,my:top+52,mh:messageHeight,iy:top+62+messageHeight,by:top+messageHeight+(this.active?.request.type==='prompt'?110:72)};
  }
  paragraphFor(text,width,color=[.12,.13,.14,1]){
    const K=this.CK,b=K.ParagraphBuilder.Make(new K.ParagraphStyle({textStyle:{fontFamilies:['DejaVu Sans Mono','Noto Sans CJK TC','Noto Sans CJK SC','Noto Sans CJK JP'],fontSize:16,color},textDirection:K.TextDirection.LTR}),this.fonts);
    try{b.addText(text);const p=b.build();p.layout(width);return p;}finally{b.delete();}
  }
  paint(){
    const e=this.active;if(!e||!this.fonts)return;
    const K=this.CK,initial=this.layout();
    if(!this.paragraph||this.paragraphWidth!==initial.inner){this.paragraph?.delete();this.paragraph=this.paragraphFor(String(e.request.message),initial.inner);this.paragraphWidth=initial.inner;}
    const g=this.geometry=this.layout(),scale=g.dpr,pw=Math.max(1,Math.floor(g.w*scale)),ph=Math.max(1,Math.floor(g.h*scale));
    if(pw>8192||ph>8192||pw*ph>16777216)throw Error('Dialog viewport too large');
    const s=K.MakeSurface(pw,ph);if(!s)throw Error('Cannot allocate dialog');
    const paint=new K.Paint();let image;
    try{
      const c=s.getCanvas();c.clear(K.TRANSPARENT);c.scale(scale,scale);
      const rect=(x,y,w,h,color)=>{paint.setColor(color);c.drawRect(K.XYWHRect(x,y,Math.max(0,w),Math.max(0,h)),paint);};
      const text=(value,x,y,width,color)=>{const p=this.paragraphFor(value,Math.max(1,width),color);try{c.drawParagraph(p,x,y);}finally{p.delete();}};
      rect(0,0,g.w,g.h,[0,0,0,.4]);rect(g.x,g.y,g.width,g.by-g.y+48,[1,1,1,1]);
      text('Land says',g.mx,g.y+18,g.inner);
      e.scroll=Math.max(0,Math.min(e.scroll,Math.max(0,this.paragraph.getHeight()-g.mh)));
      c.save();c.clipRect(K.XYWHRect(g.mx,g.my,g.inner,g.mh),K.ClipOp.Intersect,false);
      if(e.focus==='message'&&e.start!==e.end)for(const r of this.paragraph.getRectsForRange(Math.min(e.start,e.end),Math.max(e.start,e.end),K.RectHeightStyle.Tight,K.RectWidthStyle.Tight)){
        const a=r.rect??r;rect(g.mx+a[0],g.my+a[1]-e.scroll,a[2]-a[0],a[3]-a[1],[.65,.8,1,1]);
      }
      c.drawParagraph(this.paragraph,g.mx,g.my-e.scroll);c.restore();
      if(e.request.type==='prompt'){
        rect(g.mx,g.iy,g.inner,32,[.88,.9,.93,1]);
        const input=this.paragraphFor(e.value,1000000);
        try{
          const caret=input.getRectsForRange(Math.max(0,e.end-1),e.end,K.RectHeightStyle.Tight,K.RectWidthStyle.Tight).at(-1)?.rect;
          e.inputScroll=Math.max(0,Math.min(e.inputScroll??0,caret?.[2]??0));
          if((caret?.[2]??0)-e.inputScroll>g.inner-14)e.inputScroll=caret[2]-g.inner+14;
          c.save();c.clipRect(K.XYWHRect(g.mx,g.iy,g.inner,32),K.ClipOp.Intersect,false);c.translate(-(e.inputScroll??0),0);
          if(e.focus==='input')for(const r of input.getRectsForRange(Math.min(e.start,e.end),Math.max(e.start,e.end),K.RectHeightStyle.Tight,K.RectWidthStyle.Tight)){
            const a=r.rect??r;rect(g.mx+6+a[0],g.iy+6+a[1],a[2]-a[0],a[3]-a[1],[.65,.8,1,1]);
          }
          c.drawParagraph(input,g.mx+6,g.iy+6);
          if(e.focus==='input'&&e.start===e.end&&!e.caretOff){const rs=input.getRectsForRange(Math.max(0,e.end-1),e.end,K.RectHeightStyle.Tight,K.RectWidthStyle.Tight),a=rs.at(-1)?.rect;rect(g.mx+6+(a?.[2]??0),g.iy+6+(a?.[1]??0),1,19,[0,0,0,1]);}
          c.restore();
        }finally{input.delete();}
      }
      const bw=Math.max(1,Math.min(72,(g.inner-8)/2));
      this.buttons=[{accept:true,x:g.mx+g.inner-bw,y:g.by,width:bw,height:32}];
      if(e.request.type!=='alert')this.buttons.unshift({accept:false,x:g.mx+g.inner-bw*2-8,y:g.by,width:bw,height:32});
      for(const b of this.buttons){if(e.focus===(b.accept?'ok':'cancel'))rect(b.x-2,b.y-2,b.width+4,b.height+4,[.1,.2,.3,1]);rect(b.x,b.y,b.width,b.height,b.accept?[.09,.41,.82,1]:[.9,.91,.92,1]);text(b.accept?'OK':'Cancel',b.x+10,b.y+6,b.width-12,b.accept?[1,1,1,1]:undefined);}
      s.flush();image=s.makeImageSnapshot();const bytes=image.readPixels(0,0,{width:pw,height:ph,colorType:K.ColorType.RGBA_8888,alphaType:K.AlphaType.Premul,colorSpace:K.ColorSpace.SRGB});
      // Wayland ARGB8888 is BGRA in memory. The regular compositor handles
      // alpha and screenshot/raw transport exactly as for client surfaces.
      for(let i=0;i<bytes.length;i+=4){const r=bytes[i];bytes[i]=bytes[i+2];bytes[i+2]=r;}
      this.surface={desktopDialog:true,scale:1,transform:0,viewportDestination:[g.w,g.h],pixels:{width:pw,height:ph,format:0,stride:pw*4,bytes}};
    }finally{image?.delete();paint.delete();s.delete();}
    this.changed();
  }
  replace(text){const e=this.active;if(!e||e.focus!=='input')return;const a=Math.min(e.start,e.end),b=Math.max(e.start,e.end);text=String(text).replace(/[\r\n]/g,'');e.value=e.value.slice(0,a)+text+e.value.slice(b);e.start=e.end=a+text.length;}
  position(x,y){
    const g=this.geometry,e=this.active;
    if(e.focus==='input'){
      const p=this.paragraphFor(e.value,1000000);
      try{return p.getGlyphPositionAtCoordinate(x-g.mx-6+(e.inputScroll??0),y-g.iy-6).pos;}finally{p.delete();}
    }
    return this.paragraph.getGlyphPositionAtCoordinate(x-g.mx,y-g.my+e.scroll).pos;
  }
  selectAt(x,y,options){
    const e=this.active,at=this.position(x,y),value=e.focus==='input'?e.value:String(e.request.message);
    if(options.clickCount>=3){e.start=0;e.end=value.length;}
    else if(options.clickCount===2){let a=at,b=at;while(a>0&&!/\s/.test(value[a-1]))a--;while(b<value.length&&!/\s/.test(value[b]))b++;e.start=a;e.end=b;}
    else{e.end=at;if(!(options.modifiers&8))e.start=at;}
    this.dragging=true;
  }
  async invoke(method,...args){
    const e=this.active;if(!e)return;await e.ready;if(this.active!==e)return;
    const g=this.geometry;
    if(method==='move'&&!this.dragging)return;
    if(method==='evaluate')throw Error('Desktop dialog has no DOM');
    if(method==='wheel'){if(g.by+48>g.h||(e.panelScroll??0)>0)e.panelScroll=Math.max(0,Math.min((e.panelScroll??0)+args[3],g.by+48+(e.panelScroll??0)-g.h));else e.scroll+=args[3];}
    else if(method==='type'){this.replace(String(args[0]));}
    else if(method==='click'){
      const [x,y,o={}]=args;if(o.button&&o.button!=='left')return;
      if(o.phase==='down'){
        this.pressed=this.buttons.find(b=>x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height);
        if(y>=g.my&&y<g.my+g.mh&&x>=g.mx&&x<g.mx+g.inner){e.focus='message';this.selectAt(x,y,o);}
        else if(e.request.type==='prompt'&&y>=g.iy&&y<g.iy+32&&x>=g.mx&&x<g.mx+g.inner){e.focus='input';this.selectAt(x,y,o);}
      }else {this.dragging=false;const b=this.pressed;this.pressed=null;if(b&&x>=b.x&&x<b.x+b.width&&y>=b.y&&y<b.y+b.height){this.finish({accept:b.accept,promptText:e.value});return;}}
    }else if(method==='move'&&this.dragging){if(e.focus==='message'){if(args[1]<g.my)e.scroll=Math.max(0,e.scroll-20);else if(args[1]>g.my+g.mh)e.scroll=Math.min(Math.max(0,this.paragraph.getHeight()-g.mh),e.scroll+20);}e.end=this.position(args[0],args[1]);}
    else if(method==='press'){
      const [key,o={}]=args,mod=o.modifiers??0,control=!!(mod&6),shift=!!(mod&8),value=e.focus==='input'?e.value:String(e.request.message);
      if(key==='Enter'||key==='Escape'){this.finish({accept:key==='Enter'&&e.focus!=='cancel',promptText:e.value});return;}
      if(control&&key.toLowerCase()==='a'){e.start=0;e.end=value.length;}
      else if(control&&['c','x'].includes(key.toLowerCase())){const text=value.slice(Math.min(e.start,e.end),Math.max(e.start,e.end));if(text)await this.clipboard.write(text);if(key.toLowerCase()==='x')this.replace('');}
      else if(control&&key.toLowerCase()==='v'){const text=await this.clipboard.read();if(this.active!==e)return;this.replace(text);}
      else if(key==='Tab'){const order=e.request.type==='prompt'?['input','cancel','ok']:e.request.type==='confirm'?['message','cancel','ok']:['message','ok'];e.focus=order[(order.indexOf(e.focus)+(shift?order.length-1:1))%order.length];e.start=e.end=0;}
      else if(key===' '&&['ok','cancel'].includes(e.focus)){this.finish({accept:e.focus==='ok',promptText:e.value});return;}
      else if(e.focus==='message'&&shift&&['ArrowLeft','ArrowRight','Home','End'].includes(key)){e.end=key==='Home'?0:key==='End'?value.length:Math.max(0,Math.min(value.length,e.end+(key==='ArrowLeft'?-1:1)));}
      else if(e.focus==='input'){
        if(['ArrowLeft','ArrowRight','Home','End'].includes(key)){const selected=e.start!==e.end;let at=key==='Home'?0:key==='End'?value.length:!shift&&selected?(key==='ArrowLeft'?Math.min(e.start,e.end):Math.max(e.start,e.end)):Math.max(0,Math.min(value.length,e.end+(key==='ArrowLeft'?-1:1)));e.end=at;if(!shift)e.start=at;}
        else if(key==='Backspace'||key==='Delete'){if(e.start===e.end){if(key==='Backspace')e.start=Math.max(0,e.start-1);else e.end=Math.min(value.length,e.end+1);}this.replace('');}
        else if(!control&&!(mod&1)&&[...key].length===1)this.replace(key);
      }else{if(key==='Home')e.scroll=0;else if(key==='End')e.scroll=this.paragraph.getHeight();else e.scroll+=({ArrowUp:-31,ArrowDown:31,PageUp:-g.mh,PageDown:g.mh,' ':g.mh}[key]??0);}
    }
    this.paint();
  }
  async resize(){const e=this.active;if(e){await e.ready;if(this.active===e)this.paint();}}
  finish(result,entry=this.active){if(!entry||this.active!==entry)return;clearInterval(entry.timer);entry.timer=null;this.active=null;this.surface=null;this.dragging=false;this.pressed=null;this.paragraph?.delete();this.paragraph=null;entry.answer.resolve({accept:!!result.accept,promptText:String(result.promptText??'')});this.closed(result);this.changed();}
  close(){this.closedUI=true;this.finish({accept:false});this.fonts?.delete();this.fonts=null;}
}

import {Worker} from 'node:worker_threads';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Reuse the browser's modal UI unchanged (including scroll/selection/clipboard).
// Resolve lazily: normal desktops and wallpaper do not load the browser or CVK.
export async function dialogModuleUrl(){
  const paths=[];
  for(const base of [import.meta.dir,process.cwd()])try{paths.push(join(dirname(Bun.resolveSync('buninu-browser/package.json',base)),'lib/browser-dialog.js'));}catch{}
  paths.push(new URL('../../buninu-browser/lib/browser-dialog.js',import.meta.url));
  paths.push(pathToFileURL(join(dirname(process.execPath),'../lib/node_modules/buninu-browser/lib/browser-dialog.js')));
  paths.push(pathToFileURL('/usr/lib/node_modules/buninu-browser/lib/browser-dialog.js'));
  for(const path of paths)if(await Bun.file(path).exists())return path instanceof URL?path.href:pathToFileURL(path).href;
  return null;
}
async function browserDialogs(){
  const url=await dialogModuleUrl();
  if(!url)throw Error('JavaScript dialogs need the installed buninu-browser package (no package is installed automatically)');
  return import(url);
}
// Same shared reply layout and UTF-16 transport as browser/dialog-worker.js.
function finishSync(buffer,result={}){
  const state=new Int32Array(buffer,0,3);let value=String(result.promptText??'');
  try{buffer.grow(12+value.length*2);}catch{value='';result={accept:false};}
  const text=new Uint16Array(buffer,12);
  for(let i=0;i<value.length;i++)text[i]=value.charCodeAt(i);
  state[1]=value.length;state[2]=result.accept?1:0;
  Atomics.store(state,0,1);Atomics.notify(state,0);
}

export class Desktop {
  constructor({compositor,wallpaper,screenshot}){
    Object.assign(this,{compositor,wallpaper,background:screenshot});
    this.pending=new Map();this.capturedKeys=new Set();this.next=0;this.closed=false;this.dialogs=null;this.dialogPromise=null;this.dialogListener=null;
  }
  async modal(){
    if(this.closed)throw Error('Desktop closed');
    this.dialogPromise??=browserDialogs().then(({BrowserDialog})=>{
      if(this.closed)throw Error('Desktop closed');
      const c=this.compositor,clipboard={
        read:async()=>{try{const text=await c.clipboard.host.read();if(text)return text;}catch{}return c.clipboard.textCache?.bytes.toString('utf8')??'';},
        write:async text=>{c.clipboard.rememberText(text);c.clipboard.set(c.clipboard.cachedSource(),false,true);try{await c.clipboard.host.write(text);}catch{}},
      };
      return this.dialogs=new BrowserDialog({viewport:()=>({width:c.width,height:c.height,deviceScaleFactor:c.deviceScaleFactor??1}),
        background:()=>this.background({format:'png'}),changed:()=>c.onFrame?.(),clipboard,
        opened:request=>{
          // Do not strand a Wayland key/button when focus moves to the modal.
          for(const id of [...c.input.pressed.keys()])c.input.key({type:'keyUp',code:id});
          c.input.physicalMods=0;c.input.modifiers(0);
          for(const [button,code]of Object.entries({left:272,right:273,middle:274,back:275,forward:276}))if(c.input.buttons.has(code))c.input.mouse({type:'mouseReleased',button,x:c.input.x,y:c.input.y});
          this.dialogListener?.(request);
        },closed:result=>this.dialogListener?.(null,result)});
    }).catch(error=>{this.dialogPromise=null;throw error;});
    return this.dialogPromise;
  }
  get active(){return !!this.dialogs?.active;}
  get dialogState(){return this.dialogs?.active?.request??null;}
  evaluate(expression){
    if(this.closed)return Promise.reject(Error('Desktop closed'));
    if(this.pending.size>=128)return Promise.reject(Error('Desktop JavaScript queue is full'));
    if(!this.worker){
      const worker=this.worker=new Worker(new URL('./desktop-worker.js',import.meta.url));
      const fail=error=>{if(this.worker!==worker)return;this.worker=null;for(const p of this.pending.values())p.reject(error);this.pending.clear();this.dialogs?.close();this.capturedKeys.clear();this.keyDown=null;worker.terminate();};
      worker.on('error',fail);worker.on('exit',()=>{if(this.worker===worker)fail(Error('Desktop JavaScript worker exited'));});
      worker.on('message',async message=>{
        if(this.closed||this.worker!==worker)return;
        if(message.type==='result'){
          const p=this.pending.get(message.id);if(!p)return;this.pending.delete(message.id);
          message.error?p.reject(Error(message.error)):p.resolve(message.value);
        }else if(message.type==='call'){
          let result;
          try{if(message.method!=='setWallpaper')throw Error('Unknown desktop call');result={value:await this.wallpaper.set(...message.args)};}
          catch(error){result={error:error.message};}
          if(!this.closed&&this.worker===worker)worker.postMessage({type:'reply',id:message.id,...result});
        }else if(message.type==='dialog'){
          let result={accept:false};
          try{const dialogs=await this.modal();if(this.closed||this.worker!==worker)return;result=await dialogs.open({...message.request,url:'land:desktop'});}
          catch(error){console.error(`buninu-land: dialog: ${error.message}`);}
          finishSync(message.buffer,result);
        }
      });
    }
    const id=++this.next;
    return new Promise((resolve,reject)=>{
      this.pending.set(id,{resolve,reject});
      try{this.worker.postMessage({type:'evaluate',id,expression:String(expression)});}catch(error){this.pending.delete(id);reject(error);}
    });
  }
  async mouse(p){
    if(!this.active)return this.compositor.input.mouse(p);
    if(p.type==='mouseMoved')return this.dialogs.invoke('move',p.x,p.y,{modifiers:p.modifiers??0});
    if(p.type==='mouseWheel')return this.dialogs.invoke('wheel',p.x,p.y,p.deltaX??0,p.deltaY??0);
    if(p.type==='mousePressed'||p.type==='mouseReleased')return this.dialogs.invoke('click',p.x,p.y,{button:p.button,clickCount:p.clickCount,modifiers:p.modifiers,phase:p.type==='mousePressed'?'down':'up'});
  }
  async key(p){
    const id=p.code??p.key??p.text??'';
    // A dialog may close on keyDown. Consume its matching char/up as well,
    // rather than leaking the remainder of Enter/Escape to a Wayland client.
    if(p.type==='keyUp'&&this.capturedKeys.delete(id)){this.keyDown=null;return;}
    if(p.type==='char'&&this.capturedKeys.size)return;
    if(!this.active){this.keyDown=null;return this.compositor.input.key(p);}
    if(p.type==='keyDown'||p.type==='rawKeyDown')this.capturedKeys.add(id);
    const signature=`${p.code??p.key??p.text}:${p.modifiers??0}`;
    if(p.type==='keyUp'){this.keyDown=null;return;}
    if((p.type==='keyDown'||p.type==='rawKeyDown')&&(this.keyDown!==signature||p.autoRepeat)||p.type==='char'&&!this.keyDown){
      if(p.type!=='char')this.keyDown=signature;
      return this.dialogs.invoke('press',p.key??p.text??'',{...p,modifiers:p.modifiers??0});
    }
  }
  type(text){return this.active?this.dialogs.invoke('type',text):this.compositor.input.type(text);}
  screenshot(options){return this.active?this.dialogs.invoke('screenshot',options):this.background(options);}
  resize(w,h,dpr){return this.active?this.dialogs.resize(w,h,dpr):undefined;}
  handleDialog(result){if(!this.active)throw Error('No JavaScript dialog is open');this.dialogs.finish(result);}
  close(){
    if(this.closed)return;this.closed=true;this.dialogs?.close();this.dialogListener=null;this.capturedKeys.clear();this.keyDown=null;
    const worker=this.worker;this.worker=null;worker?.terminate();
    for(const p of this.pending.values())p.reject(Error('Desktop closed'));this.pending.clear();
  }
}

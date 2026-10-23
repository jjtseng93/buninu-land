import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { powershellClipboard } from './clipboard-powershell.js';
export const MAX_TEXT = 1024 * 1024;
export const TIMEOUT = 2500;

// xclip is deliberately first on EVERY platform, including Windows/Termux.
// Other command forms follow jsmdcui's platform/clipboard.js.
export function clipboardBackends({platform=process.platform, env=process.env, socket, which=Bun.which}={}) {
  const result=[];
  const add=(name,write,read,primary=false)=>{
    const w=which(write[0]),r=which(read[0]);
    if(w||r)result.push({name,write:w?[w,...write.slice(1)]:null,read:r?[r,...read.slice(1)]:null,primary});
  };
  add('xclip',['xclip','-selection','clipboard'],['xclip','-selection','clipboard','-o'],true);
  if(platform==='win32') {
    for(const name of ['pwsh.exe','powershell.exe','pwsh','powershell']) {
      const path=which(name);if(path){result.push({name:'powershell',backend:powershellClipboard(path)});break;}
    }
  } else if(platform==='darwin') add('pbcopy/pbpaste',['pbcopy'],['pbpaste']);
  else {
    const wayland=env.WAYLAND_DISPLAY;
    const parent=wayland?resolve(env.XDG_RUNTIME_DIR||env.TMPDIR||tmpdir(),wayland):null;
    // A private nested compositor must never use itself as the host clipboard.
    if(parent && (!socket || parent!==resolve(socket)))add('wl-clipboard',['wl-copy'],['wl-paste','--no-newline'],true);
    add('xsel',['xsel','--clipboard','--input'],['xsel','--clipboard','--output'],true);
    add('termux',['termux-clipboard-set'],['termux-clipboard-get']);
  }
  return result;
}

export class HostClipboard {
  constructor(options={}) {this.options=options;this.backends=clipboardBackends(options);this.children=new Set();this.closed=false;}
  async command(args,text) {
    if(this.closed)throw Error('Clipboard closed');
    const child=(this.options.spawn??Bun.spawn)(args,{env:this.options.env??process.env,
      stdin:text===undefined?'ignore':Buffer.from(text),stdout:text===undefined?'pipe':'ignore',stderr:'ignore'});
    this.children.add(child);
    const timer=setTimeout(()=>child.kill(9),TIMEOUT);
    try {
      let output='';
      if(text===undefined) {
        const chunks=[];let size=0;
        for await(const chunk of child.stdout){size+=chunk.length;if(size>MAX_TEXT){child.kill(9);throw Error('Clipboard text exceeds limit');}chunks.push(chunk);}
        output=Buffer.concat(chunks).toString('utf8');
      }
      if(await child.exited!==0)throw Error('Clipboard command failed');
      return output;
    } catch(error) {
      child.kill(9);throw error;
    } finally {clearTimeout(timer);this.children.delete(child);}
  }
  async perform(op,text,primary=false) {
    if(text!==undefined&&(typeof text!=='string'||Buffer.byteLength(text)>MAX_TEXT))throw Error('Clipboard text exceeds limit');
    for(const entry of this.backends) {
      if(this.closed)break;
      if(primary&&!entry.primary)continue;
      try {
        if(entry.backend) {
          if(op==='write'){if(!entry.backend.write(text))continue;return;}
          const result=entry.backend.read();if(Buffer.byteLength(result)>MAX_TEXT)continue;return result;
        }
        let args=entry[op];if(!args)continue;
        if(primary)args=args.map(v=>v==='clipboard'?'primary':v==='--clipboard'?'--primary':v);
        if(primary&&entry.name==='wl-clipboard')args=[...args,'--primary'];
        return await this.command(args,text);
      } catch {}
    }
    throw Error('No working clipboard command (xclip preferred)');
  }
  read(primary=false){return this.perform('read',undefined,primary);}
  write(text,primary=false){return this.perform('write',text,primary);}
  close(){this.closed=true;for(const child of this.children)child.kill(9);}
}

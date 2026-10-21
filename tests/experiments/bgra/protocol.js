// Private experiment; not a registered Kitty pixel format.
export const BGRA_FORMAT = 0x42475241;
export const BGRA_REPLY = 'OK Buninu1 bgra';
export function preferredPixelFormat(display, littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1) {
  if (!littleEndian || display?.bitsPerPixel !== 32) return 'png';
  const f=display.fields;
  const channel=(field,offset)=>field?.offset===offset&&field.length===8&&!field.msbRight;
  const alpha=f?.transp;
  if(alpha?.length && !channel(alpha,24))return 'png';
  if(!channel(f?.green,8))return 'png';
  if(channel(f?.red,16)&&channel(f?.blue,0))return 'bgra';
  if(channel(f?.red,0)&&channel(f?.blue,16))return 'rgba';
  return 'png';
}
export function parsePreference(message) {
  if(message==='OK Buninu1 bgra')return 'bgra';
  if(message==='OK Buninu1 rgba')return 'rgba';
  return 'png';
}

// Query never displays pixels. A plain OK is deliberately insufficient:
// some terminals only check transport readability, not pixel format support.
export class BgraProbe {
  constructor({write,createFile,removeFile,timeout=700}) {
    Object.assign(this,{write,createFile,removeFile,timeout});
  }
  query() {
    this.stop();
    this.id=100000+Math.floor(Math.random()*2000000000);
    return new Promise(resolve=>{
      this.resolve=resolve;
      try {
        this.path=this.createFile(Buffer.from([7,19,239,255]));
        this.timer=setTimeout(()=>this.finish('png'),this.timeout);
        this.write(`\x1b_Ga=q,t=f,f=${BGRA_FORMAT},s=1,v=1,i=${this.id},q=0;${Buffer.from(this.path).toString('base64')}\x1b\\`);
      }catch{this.finish('png');}
    });
  }
  reply(id,message) {
    if(this.resolve&&Number(id)===this.id)this.finish(parsePreference(message));
  }
  finish(supported) {
    clearTimeout(this.timer);
    if(this.path){try{this.removeFile(this.path);}catch{}this.path=null;}
    const resolve=this.resolve;this.resolve=null;resolve?.(supported);
  }
  stop(){this.finish('png');}
}

// Opt-in wrapper used ONLY by the experimental native bunterm instance.
// Browser jsgotty and existing terminal sessions retain their original parser.
export function bgraParser(Base,display) {
  return class extends Base {
    _resolveImageData(control,payload) {
      const bytes=super._resolveImageData(control,payload);
      if(Number(control.f)===BGRA_FORMAT){
        const w=Number(control.s),h=Number(control.v);
        if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w*h>16777216||bytes.length!==w*h*4)
          throw Error('Invalid BGRA dimensions or byte count');
      }
      return bytes;
    }
    _parsePacket(packet,cursor) {
      const result=super._parsePacket(packet,cursor);
      if(result?.kind==='query'&&Number(result.control.f)===BGRA_FORMAT&&result.responseMessage==='OK')
        result.responseMessage='OK Buninu1 '+preferredPixelFormat(display);
      return result;
    }
  };
}

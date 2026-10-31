import {stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DEFAULT_WALLPAPER = fileURLToPath(new URL('../wallpaper.jpg', import.meta.url));
const MAX_PIXELS = 16777216, MAX_BYTES = 64 * 1024 * 1024;
const validSize = (w,h) => [w,h].every(n=>Number.isInteger(n)&&n>0&&n<=16384) && w*h<=MAX_PIXELS;
const paeth = (a,b,c) => { const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c; };

// Decode only our own Bun.Image-generated, non-interlaced RGBA8 PNG output.
// External files always go through Bun.Image first, with a source pixel limit.
export function decodeWallpaperPng(png,width,height) {
  if (!validSize(width,height) || png.length<33 || png.length>MAX_BYTES*2) throw Error('Invalid wallpaper PNG size');
  const view=new DataView(png.buffer,png.byteOffset,png.byteLength),parts=[];
  if(view.getUint32(0)!==0x89504e47||view.getUint32(4)!==0x0d0a1a0a)throw Error('Invalid wallpaper PNG signature');
  let header=false,end=false;
  for(let p=8;p<png.length;){
    if(p+12>png.length)throw Error('Truncated wallpaper PNG');
    const size=view.getUint32(p),type=view.getUint32(p+4);
    if(size>png.length-p-12)throw Error('Invalid wallpaper PNG chunk');
    if(type===0x49484452){
      if(header||p!==8||size!==13||view.getUint32(p+8)!==width||view.getUint32(p+12)!==height||png[p+16]!==8||png[p+17]!==6||png[p+18]!==0||png[p+19]!==0||png[p+20]!==0)throw Error('Unsupported wallpaper PNG layout');
      header=true;
    }else if(type===0x49444154){if(!header)throw Error('Missing wallpaper PNG header');parts.push(png.subarray(p+8,p+8+size));}
    else if(type===0x49454e44){if(size!==0)throw Error('Invalid wallpaper PNG end');end=true;break;}
    p+=size+12;
  }
  if(!header||!end||!parts.length)throw Error('Incomplete wallpaper PNG');
  const zlib=Buffer.concat(parts),stride=width*4,expected=(stride+1)*height;
  if(zlib.length<6||(zlib[0]&15)!==8||((zlib[0]<<8)+zlib[1])%31||(zlib[1]&32))throw Error('Invalid wallpaper zlib stream');
  // Bun.Image owns this compressed stream: external PNG bytes never reach here.
  const raw=Bun.inflateSync(zlib.subarray(2,-4));
  if(raw.length!==expected)throw Error('Invalid wallpaper scanline length');
  const pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++){
    const from=y*(stride+1),row=y*stride,filter=raw[from],start=from+1;
    if(filter===0){pixels.set(raw.subarray(start,start+stride),row);continue;}
    if(filter===1){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+(x>=4?pixels[row+x-4]:0);}
    else if(filter===2){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+(y?pixels[row+x-stride]:0);}
    else if(filter===3){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+(((x>=4?pixels[row+x-4]:0)+(y?pixels[row+x-stride]:0))>>1);}
    else if(filter===4){for(let x=0;x<stride;x++)pixels[row+x]=raw[start+x]+paeth(x>=4?pixels[row+x-4]:0,y?pixels[row+x-stride]:0,y&&x>=4?pixels[row+x-stride-4]:0);}
    else throw Error('Invalid wallpaper PNG filter');
  }
  return pixels;
}

export function cropWallpaper(rgba,sw,sh,width,height) {
  const bytes=new Uint8Array(width*height*4),out=new Uint32Array(bytes.buffer),src=new Uint32Array(rgba.buffer,rgba.byteOffset,rgba.byteLength/4);
  const x0=Math.floor((sw-width)/2),y0=Math.floor((sh-height)/2);
  if(x0<0||y0<0||rgba.length!==sw*sh*4)throw Error('Invalid wallpaper crop');
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y+y0)*sw+x+x0,p=src[at],d=y*width+x;
    if((p>>>24)===255){out[d]=(p&0xff00ff00)|((p&255)<<16)|((p>>>16)&255);continue;}
    const a=rgba[at*4+3]/255;
    bytes[d*4]=Math.round(rgba[at*4+2]*a+34*(1-a));
    bytes[d*4+1]=Math.round(rgba[at*4+1]*a+27*(1-a));
    bytes[d*4+2]=Math.round(rgba[at*4]*a+24*(1-a));bytes[d*4+3]=255;
  }
  return bytes;
}

export class Wallpaper {
  constructor({fallback=DEFAULT_WALLPAPER,changed=()=>{}}={}){this.fallback=fallback;this.changed=changed;this.current=null;this.surface=null;this.generation=0;this.closed=false;}
  async source(path){
    const info=await stat(path);
    if(!info.isFile()||info.size>MAX_BYTES)throw Error('Not a supported wallpaper file');
    const bytes=await Bun.file(path).slice(0,MAX_BYTES+1).bytes();
    if(bytes.length>MAX_BYTES)throw Error('Wallpaper file too large');
    const meta=await new Bun.Image(bytes,{maxPixels:MAX_PIXELS}).metadata();
    if(!validSize(meta.width,meta.height))throw Error('Wallpaper dimensions exceed limit');
    // Decode now so corrupt images fall back before replacing the current image.
    await new Bun.Image(bytes,{maxPixels:MAX_PIXELS}).resize(1,1).png({compressionLevel:0}).bytes();
    return {path,bytes,...meta,sizes:new Map()};
  }
  async set(path){
    if(path===null)return null; // prompt cancellation leaves the current wallpaper alone
    if(typeof path!=='string')throw new TypeError('setWallpaper expects a path string');
    if(this.closed)throw Error('Wallpaper closed');
    const generation=++this.generation;
    let selected;try{selected=await this.source(resolve(path));}catch{selected=await this.source(this.fallback);}
    if(this.closed||generation!==this.generation)return null;
    this.current=selected;this.surface=null;this.changed();return selected.path;
  }
  async prepare(width,height,dpr=1){
    const source=this.current;if(!source||this.closed)return null;
    const w=Math.max(1,Math.floor(width*dpr)),h=Math.max(1,Math.floor(height*dpr));
    if(!validSize(w,h))throw Error('Invalid wallpaper output size');
    const key=`${width}:${height}:${dpr}`;
    let task=source.sizes.get(key);
    if(!task){
      task=(async()=>{
        const ratio=Math.max(w/source.width,h/source.height),sw=Math.ceil(source.width*ratio),sh=Math.ceil(source.height*ratio);
        if(!validSize(sw,sh))throw Error('Wallpaper cover intermediate exceeds pixel limit');
        const png=await new Bun.Image(source.bytes,{maxPixels:MAX_PIXELS}).resize(sw,sh,{filter:'bilinear'}).png({compressionLevel:0}).bytes();
        const bytes=cropWallpaper(decodeWallpaperPng(png,sw,sh),sw,sh,w,h);
        return {wallpaper:true,pixels:{bytes,width:w,height:h,stride:w*4,format:1},scale:1,transform:0,viewportDestination:[width,height],fractionalScale:true};
      })();
      source.sizes.set(key,task);
      task.catch(()=>{if(source.sizes.get(key)===task)source.sizes.delete(key);});
    }
    const surface=await task;
    // An old resize or replaced wallpaper may finish after a newer request.
    if(this.current===source&&!this.closed)this.surface=surface;
    return surface;
  }
  close(){this.closed=true;this.generation++;this.current=null;this.surface=null;}
}

// Accept both engine flag forms, with the last occurrence taking precedence.
export function wallpaperArgument(args) {
  let path=null;
  for(let i=0;i<args.length;i++){
    if(args[i].startsWith('--wallpaper='))path=args[i].slice(12);
    else if(args[i]==='--wallpaper'){
      if(!args[i+1]||args[i+1].startsWith('--'))throw Error('--wallpaper requires a path');
      path=args[++i];
    }
  }
  if(path==='')throw Error('--wallpaper requires a path');
  return path;
}

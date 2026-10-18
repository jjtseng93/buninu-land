import {toArrayBuffer} from 'bun:ffi';
import {libc} from './transport.js';

// CPU-readable, single-plane ARGB8888/XRGB8888 with explicit LINEAR layout.
// No implicit modifiers, tiled images, GPU import, or scanout is claimed.
export const linearFormats = [0x34325241, 0x34325258];
const MAX_BYTES = 256 * 1024 * 1024;
const fail = (code, message) => { throw Object.assign(Error(message), {protocolCode:code}); };

export class DmabufParams {
  constructor(sys=libc) { this.sys=sys; this.planes=new Map(); this.used=false; }
  add(fd, index, offset, stride, hi, lo) {
    try {
      if(this.used)fail(0,'DMA-BUF params already used');
      if(index>3)fail(1,'DMA-BUF plane index out of bounds');
      if(this.planes.has(index))fail(2,'DMA-BUF plane already set');
      this.planes.set(index,{fd,offset,stride,hi,lo});
    } catch(error) { this.sys.close(fd); throw error; }
  }
  close() { for(const p of this.planes.values())this.sys.close(p.fd);this.planes.clear(); }
  create(width,height,format,flags) {
    if(this.used)fail(0,'DMA-BUF params already used');
    this.used=true;
    try {
      if(!this.planes.has(0))fail(3,'DMA-BUF plane zero missing');
      if(!linearFormats.includes(format))fail(4,'Unsupported DMA-BUF format');
      if(width<=0||height<=0||width>8192||height>8192)fail(5,'Invalid DMA-BUF dimensions');
      // Other plane layouts/flags are well-formed but not importable here.
      if(this.planes.size!==1||flags!==0)return null;
      const p=this.planes.get(0);
      if(p.hi!==0||p.lo!==0)return null;
      const length=p.stride*height,end=p.offset+length;
      if(p.stride<width*4||p.stride%4||end>MAX_BYTES)fail(6,'DMA-BUF stride or extent out of bounds');
      const size=Number(this.sys.lseek(p.fd,0,2));
      if(size<0)return null;
      if(end>size)fail(6,'DMA-BUF exceeds fd size');
      // Test DMA_BUF_IOCTL_SYNC before mmap: ordinary files are not DMA-BUFs.
      const sync=Buffer.alloc(8);sync.writeBigUInt64LE(1n); // START | READ
      if(this.sys.ioctl(p.fd,0x40086200,sync)<0)return null;
      sync.writeBigUInt64LE(5n); // END | READ
      if(this.sys.ioctl(p.fd,0x40086200,sync)<0)return null;
      const address=this.sys.mmap(null,end,1,1,p.fd,0);
      if(!address||address===-1||BigInt(address)===0xffffffffffffffffn)return null;
      const sys=this.sys;let closed=false,refs=1;
      const drop=()=>{if(--refs===0){sys.munmap(address,end);sys.close(p.fd);}};
      this.planes.delete(0); // ownership transferred to wl_buffer
      return {
        width,height,stride:p.stride,format:format===linearFormats[0]?0:1,
        retain() { if(!refs)throw Error('DMA-BUF mapping is closed');refs++;let released=false;return ()=>{if(!released){released=true;drop();}}; },
        snapshot(measure) {
          let started=measure?performance.now():0;
          sync.writeBigUInt64LE(1n);
          if(sys.ioctl(p.fd,0x40086200,sync)<0)throw Error('DMA-BUF read synchronization failed');
          measure?.('dmabuf-sync-start',performance.now()-started);
          try {
            started=measure?performance.now():0;
            const bytes=Buffer.from(new Uint8Array(toArrayBuffer(address,p.offset,length)));
            measure?.('dmabuf-copy',performance.now()-started);return bytes;
          }
          finally { started=measure?performance.now():0;sync.writeBigUInt64LE(5n);if(sys.ioctl(p.fd,0x40086200,sync)<0)throw Error('DMA-BUF end synchronization failed');measure?.('dmabuf-sync-end',performance.now()-started); }
        },
        close() { if(closed)return;closed=true;drop(); },
      };
    } finally { this.close(); }
  }
}

// Experimental: hold ownership until capture or replacement, never release then read.
export function deferDmabuf(buffer, onRelease, measure) {
  const {width,height,stride,format,dmabuf}=buffer;
  const drop=dmabuf.retain();buffer.readers=(buffer.readers??0)+1;
  let bytes,released=false,failure;
  const dispose=()=>{
    if(released)return;released=true;drop();
    if(--buffer.readers===0)onRelease();
  };
  return {width,height,stride,format,dispose,
    get bytes(){
      if(failure)throw failure;
      if(bytes)return bytes;
      if(released)throw Error('Discarded DMA-BUF frame');
      try {bytes=dmabuf.snapshot(measure);return bytes;}
      catch(error){failure=error;throw error;}
      finally {dispose();}
    },
  };
}

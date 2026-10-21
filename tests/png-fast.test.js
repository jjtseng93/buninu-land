import {test,expect} from 'bun:test';
import {inflateSync} from 'node:zlib';
import {encodePng} from '../lib/png-fast.js';
test('RGB pair loop preserves Sub bytes, odd tails, row resets and both channel orders',()=>{
 for(const width of [1,2,3,19,64])for(const bgra of [true,false])for(const opaque of [true,false]){
  const height=7,pixels=new Uint32Array(width*height);
  for(let i=0;i<pixels.length;i++)pixels[i]=(Math.imul(i+1,9182371)|(opaque?0xff000000:0))>>>0;
  const png=encodePng(pixels,width,height,bgra,opaque),parts=[];
  for(let offset=8;offset<png.length;){const n=png.readUInt32BE(offset);if(png.toString('ascii',offset+4,offset+8)==='IDAT')parts.push(png.subarray(offset+8,offset+8+n));offset+=n+12;}
  const channels=opaque?3:4,expected=Buffer.alloc((width*channels+1)*height);let offset=0;
  const shifts=bgra?[16,8,0,24]:[0,8,16,24];
  for(let y=0;y<height;y++){
   expected[offset++]=1;const previous=[0,0,0,0];
   for(let x=0;x<width;x++)for(let c=0;c<channels;c++){
    const value=(pixels[y*width+x]>>>shifts[c])&255;
    expected[offset++]=(value-previous[c])&255;previous[c]=value;
   }
  }
  expect(inflateSync(Buffer.concat(parts))).toEqual(expected);
  if(opaque)expect(encodePng(pixels,width,height,bgra,false)).toEqual(png);
 }
});

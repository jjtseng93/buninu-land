import {test,expect} from 'bun:test';
import {patchKgsl} from './kgsl-patch.js';
function fixture(base=0x1000){
 const bytes=Buffer.alloc(1024);Buffer.from('7f454c460201','hex').copy(bytes);
 bytes.writeUInt16LE(183,18);bytes.writeBigUInt64LE(64n,32);bytes.writeUInt16LE(56,54);bytes.writeUInt16LE(1,56);
 bytes.writeUInt32LE(1,64);bytes.writeUInt32LE(5,68);bytes.writeBigUInt64LE(BigInt(base),80);bytes.writeBigUInt64LE(1024n,96);
 bytes.write('/dev/kgsl-3d0\0',512);
 const pc=base+132,target=base+256;
 const rows=[[128,0x94000000,'bl 100 <wl_display_roundtrip_queue@plt>'],
 [132,0x37f80000|((target-pc)/4<<5),`tbnz w0, #31, ${target.toString(16)} <dri2_initialize_wayland+0x80>`],
 [256,0xb9407280,'ldr w0, [x20, #112]'],[260,0x34000000,'cbz w0, 100 <error>'],
 [264,0x90000000,`adrp x0, ${base.toString(16)}`],[268,0x91080000,'add x0, x0, #0x200'],
 [272,0x94000000,'bl 200 <loader_open_device>'],[276,0xb9005a60,'str w0, [x19, #88]'],[280,0x14000000,'b 300 <resume>']];
 for(const [o,w] of rows)bytes.writeUInt32LE(w>>>0,o);
 const disassembly=`${(base+128).toString(16)} <dri2_initialize_wayland>:\n`+rows.map(([o,w,t])=>`${(base+o).toString(16)}: ${(w>>>0).toString(16).padStart(8,'0')} ${t}`).join('\n');
 return {bytes,disassembly};
}
test('KGSL matcher follows relocated addresses and accepts unrelated binary changes',()=>{
 for(const base of [0x1000,0x8000]){
  const f=fixture(base);f.bytes[900]=123;
  const p=patchKgsl(f.bytes,f.disassembly);
  expect(p.offset).toBe(132);expect(p.target).toBe(base+256);
  expect(p.bytes.readUInt32LE(132)).toBe(0x1400001f);
  expect(p.bytes[900]).toBe(123);expect(f.bytes.readUInt32LE(132)).toBe(p.original);
 }
});
test('KGSL matcher rejects missing path, symbols and mismatched disassembly',()=>{
 const f=fixture();
 expect(()=>patchKgsl(f.bytes,f.disassembly.replace('loader_open_device','another_function'))).toThrow('found 0');
 f.bytes[512]=0;expect(()=>patchKgsl(f.bytes,f.disassembly)).toThrow('found 0');
 const g=fixture();g.bytes[132]=0;expect(()=>patchKgsl(g.bytes,g.disassembly)).toThrow('does not match');
 expect(()=>patchKgsl(Buffer.alloc(64),'')).toThrow('AArch64');
});

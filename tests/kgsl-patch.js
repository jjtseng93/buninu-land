// Conservative AArch64 ELF control-flow matcher for custom Mesa's KGSL fallback.
export function patchKgsl(bytes, disassembly) {
 if(bytes.length<64||bytes.toString('hex',0,6)!=='7f454c460201'||bytes.readUInt16LE(18)!==183)
  throw Error('Expected a little-endian AArch64 ELF64 library');
 const segments=[],ph=Number(bytes.readBigUInt64LE(32)),size=bytes.readUInt16LE(54),count=bytes.readUInt16LE(56);
 if(size<56||ph+size*count>bytes.length)throw Error('Invalid ELF program headers');
 for(let i=0;i<count;i++){
  const p=ph+i*size;if(bytes.readUInt32LE(p)!==1)continue;
  segments.push({offset:Number(bytes.readBigUInt64LE(p+8)),address:Number(bytes.readBigUInt64LE(p+16)),length:Number(bytes.readBigUInt64LE(p+32)),flags:bytes.readUInt32LE(p+4)});
 }
 const offset=(address,length=4,executable=false)=>{
  const s=segments.find(s=>address>=s.address&&address+length<=s.address+s.length&&(!executable||(s.flags&1)));
  if(!s||s.offset+address-s.address+length>bytes.length)throw Error('Address outside ELF load segments');
  return s.offset+address-s.address;
 };
 const instructions=new Map();let active=false;
 for(const line of disassembly.split('\n')){
  const label=line.match(/^\s*[0-9a-f]+ <([^>]+)>:$/);
  if(label){active=label[1]==='dri2_initialize_wayland';continue;}
  if(!active)continue;
  const m=line.match(/^\s*([0-9a-f]+):\s+([0-9a-f]{8})\s+(.+)$/);
  if(m)instructions.set(parseInt(m[1],16),{word:parseInt(m[2],16),text:m[3].trim()});
 }
 // Verify disassembly against the input before interpreting its control flow.
 for(const [pc,i] of instructions)if(bytes.readUInt32LE(offset(pc,4,true))!==i.word)throw Error('Disassembly does not match ELF bytes');
 const text=pc=>instructions.get(pc)?.text??'',matches=[];
 for(const [pc,i] of instructions){
  const branch=i.text.match(/^tbnz\s+w0,\s*#31,\s*([0-9a-f]+)\s/);
  if(!branch||!/^bl\s+.*<wl_display_roundtrip_queue(?:@plt)?>/.test(text(pc-4)))continue;
  const target=parseInt(branch[1],16);
  if(!/^ldr\s+w0,\s*\[x\d+,/.test(text(target))||!/^cbz\s+w0,/.test(text(target+4)))continue;
  const page=text(target+8).match(/^adrp\s+x0,\s*([0-9a-f]+)/);
  const add=text(target+12).match(/^add\s+x0,\s*x0,\s*#(0x[0-9a-f]+|\d+)$/);
  if(!page||!add||!/^bl\s+.*<loader_open_device(?:@plt)?>/.test(text(target+16)))continue;
  if(!/^str\s+w0,\s*\[x\d+,/.test(text(target+20))||!/^b\s+[0-9a-f]+\s/.test(text(target+24)))continue;
  const path=Buffer.from('/dev/kgsl-3d0\0');
  const pathOffset=offset(parseInt(page[1],16)+Number(add[1]),path.length);
  if(!bytes.subarray(pathOffset,pathOffset+path.length).equals(path))continue;
  // Confirm the branch encoding and destination independently of objdump text.
  const immediate=(i.word>>>5)&0x3fff,delta=(immediate&0x2000?immediate-0x4000:immediate)*4;
  if((i.word&0xfff8001f)!==(0x37f80000|0)||pc+delta!==target)continue;
  matches.push({offset:offset(pc,4,true),address:pc,target,original:i.word,instruction:(0x14000000|((delta/4)&0x3ffffff))>>>0});
 }
 if(matches.length!==1)throw Error(`Expected one verified KGSL fallback branch; found ${matches.length}. Unsupported or already patched Mesa build.`);
 const match=matches[0],patched=Buffer.from(bytes);patched.writeUInt32LE(match.instruction,match.offset);
 return {...match,bytes:patched};
}

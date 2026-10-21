// Run inside a real Konsole: bun konsole-probe.js /tmp/konsole-bgra-result.json
import {writeFileSync,unlinkSync,mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {BgraProbe,BGRA_FORMAT,BGRA_REPLY} from './protocol.js';
import {patchTransport} from './patch.js';
import {encodePng} from '../../../lib/png-fast.js';
const source=readFileSync(new URL('../../../../casty/lib/kitty-transport.js',import.meta.url),'utf8');
const {KittyTransport}=await import('data:text/javascript;base64,'+Buffer.from(patchTransport(source)).toString('base64'));
const dir=mkdtempSync(join(tmpdir(),'konsole-bgra-')),output=process.argv[2],writes=[],replies=[];
const write=s=>{writes.push(s);process.stdout.write(s);};
const probe=new BgraProbe({write,createFile:bytes=>{const p=join(dir,'p');writeFileSync(p,bytes);return p;},removeFile:unlinkSync,timeout:1000});
const transport=new KittyTransport({write,createProbe(){},removeProbe(){},onReply:(id,msg)=>{replies.push({id,msg});probe.reply(id,msg);}});
process.stdin.setRawMode(true);process.stdin.resume();
process.stdin.on('data',chunk=>transport.feed(chunk.toString(),()=>{}));
try{
 const format=await probe.query(),supported=format!=='png';
 // A second, inline unknown-format query checks terminals that blindly OK it.
 write(`\x1b_Ga=q,t=d,f=${BGRA_FORMAT},s=1,v=1,i=99173,q=0;BxPv/w==\x1b\\`);
 await Bun.sleep(1100);
 // Use a known PNG fallback: never transmit BGRA after a negative query.
 const png=Buffer.from(encodePng(new Uint32Array([0xffff0000]),1,1,true,true)).toString('base64');
 if(!supported)write(`\x1b_Ga=T,t=d,f=100,s=1,v=1,i=99174,q=1;${png}\x1b\\`);
 await Bun.sleep(300);
 writeFileSync(output,JSON.stringify({supported,replies,writes,expectedReply:BGRA_REPLY,bgraPlacements:writes.filter(s=>s.includes('a=T')&&s.includes('f='+BGRA_FORMAT)).length},null,2));
}finally{probe.stop();transport.stop();process.stdin.setRawMode(false);rmSync(dir,{recursive:true,force:true});}
process.exit(0);

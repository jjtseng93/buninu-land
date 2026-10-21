// Native test machine only. Requires prior diagnostic harnesses under /tmp.
// Run with native Bun; backups are restored after the measurement.
import {readFileSync as r,writeFileSync as w,cpSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {patchRenderer,patchImages,patchKitty,patchTransport,patchBrowser} from './patch.js';
const root='/mint/buninu/buninu-land';
if(r(root+'/lib/renderer.js','utf8').includes('./raw-frames.js'))throw Error('Historical harness: refusing to patch production raw frames');
cpSync(root+'/lib/renderer.js','/tmp/pre-bgra-renderer.js');
w(root+'/lib/renderer.js',patchRenderer(r('/tmp/pre-bgra-renderer.js','utf8')));
cpSync('/tmp/casty-raw-diag','/tmp/casty-bgra-diag',{recursive:true});
cpSync(new URL('./protocol.js',import.meta.url),'/tmp/casty-bgra-diag/lib/bgra-protocol.js');
w('/tmp/casty-bgra-diag/lib/kitty.js',patchKitty(r('/tmp/casty-expanded-diag/lib/kitty.js','utf8')));
w('/tmp/casty-bgra-diag/lib/kitty-transport.js',patchTransport(r('/tmp/casty-expanded-diag/lib/kitty-transport.js','utf8')));
cpSync(new URL('./capture-format.js',import.meta.url),'/tmp/casty-bgra-diag/lib/capture-format.js');
let bin="import {negotiateCapture} from '../lib/capture-format.js';\n"+r('/tmp/casty-raw-diag/bin/casty.js','utf8').replace(/^#![^\n]*\n/,'');
bin=bin.replace('import { sendFrame,','import { queryBgra, sendFrame,');
const start=bin.indexOf("  const fmt = 'rgba';"),end=bin.indexOf('  console.error(`casty:',start);
if(start<0||end<0)throw Error('Missing capture selection');
bin=bin.slice(0,start)+`  const transport=detectTransport();
  const choice=await negotiateCapture(client,{configured:config.format||'auto',transport,queryPreference:queryBgra});
  let screenshotFormat=choice.format;
`+bin.slice(end);
bin=bin.replaceAll('format: screenshotFormat,\n', 'format: screenshotFormat,\n    fallbackFormat: choice.fallbackFormat, onFormatChange: format => { screenshotFormat=format; },\n')
 .replace('  // Phase 3: Start screencast','  if(choice.firstFrame)onFrame(choice.firstFrame);\n\n  // Phase 3: Start screencast');
w('/tmp/casty-bgra-diag/bin/casty.js',bin);
w('/tmp/casty-bgra-diag/lib/browser.js',patchBrowser(r('/tmp/casty-expanded-diag/lib/browser.js','utf8')));
w('/tmp/casty-bgra-diag/lib/diag.js',r('/tmp/casty-raw-diag/lib/diag.js','utf8').replaceAll('raw-','bgra-'));
mkdirSync('/tmp/bgra-bunterm',{recursive:true});
cpSync(new URL('./protocol.js',import.meta.url),'/tmp/bgra-bunterm/protocol.js');
w('/tmp/bgra-bunterm/images.js',patchImages(r('/lib/bunterm/images.js','utf8')));
let terminal=r('/lib/bunterm/terminal.js','utf8');
terminal=terminal.replace(/from "(\.[^"]+)"/g,(all,p)=>`from "${p==='./images.js'?'/tmp/bgra-bunterm/images.js':resolve('/lib/bunterm',p)}"`)
 .replace('require("../../buninu/apps/jsgotty/gotty.js")','require("/buninu/apps/jsgotty/gotty.js")')
 .replace('new KittyGraphicsParser({ binaryData: true })','new (bgraParser(KittyGraphicsParser,screen.display))({ binaryData: true })');
w('/tmp/bgra-bunterm/terminal.js',"import {bgraParser} from './protocol.js';\n"+terminal);
for(const [src,dst] of [['raw-land-engine.js','bgra-land-engine.js'],['raw-timing-diag.js','bgra-timing-diag.js']]){
 let s=r('/tmp/'+src,'utf8').replaceAll('raw-','bgra-');
 if(dst==='bgra-timing-diag.js')s=s.replace("'/lib/bunterm/terminal.js'","'/tmp/bgra-bunterm/terminal.js'").replace("'/lib/bunterm/images.js'","'/tmp/bgra-bunterm/images.js'");
 w('/tmp/'+dst,s);
}

import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {negotiateCapture,standardFormat} from './capture-format.js';
import {patchBrowser} from './patch.js';

test('raw outranks explicit formats and preserves each original fallback',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'raw-cdp-'));
 try{
  const path=join(dir,'pixel');writeFileSync(path,Buffer.from([1,2,3,255]));
  for(const configured of ['auto','png','jpeg','webp'])for(const preferred of ['bgra','rgba']){
   let calls=0;const data=JSON.stringify({path,format:preferred,width:1,height:1,bytes:4});
   const result=await negotiateCapture({async send(method,params){calls++;expect(params.format).toBe(preferred);return {data};}},
     {configured,transport:'file',queryPreference:async()=>preferred});
   expect(result).toEqual({format:preferred,fallbackFormat:standardFormat(configured,'file'),firstFrame:data});
   expect(calls).toBe(1);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('CDP rejection, ignored format, bad descriptor, unreadable file and timeout restore configured policy',async()=>{
 for(const configured of ['auto','png','jpeg','webp']){
  const responses=[()=>{throw Error('Invalid image format');},()=>({data:'iVBORw0KGgo='}),()=>({data:'{}'}),()=>({data:JSON.stringify({path:'/missing-raw-probe',width:1,height:1,bytes:4,format:'bgra'})}),()=>new Promise(()=>{})];
  for(const send of responses){
   const result=await negotiateCapture({send},{configured,transport:'file',queryPreference:async()=> 'bgra',timeout:5});
   expect(result.format).toBe(standardFormat(configured,'file'));expect(result.firstFrame).toBeUndefined();
  }
 }
 let queries=0;
 expect((await negotiateCapture({send(){throw Error('must not probe');}},{configured:'auto',transport:'inline',queryPreference:()=>queries++})).format).toBe('png');
 expect(queries).toBe(0);
 expect((await negotiateCapture({send(){throw Error('must not probe');}},{transport:'file',queryPreference:async()=> 'png'})).format).toBe('jpeg');
});

test('live raw failure switches to JPEG and still refines to PNG',async()=>{
 // Import the generated browser module beside its original relative imports.
 const url=new URL('../../../../casty/lib/.capture-format-test-'+process.pid+'.js',import.meta.url);
 const helper=new URL('./capture-format.js',import.meta.url).href;
 const code=patchBrowser(readFileSync(new URL('../../../../casty/lib/browser.js',import.meta.url),'utf8')).replace("'./capture-format.js'",JSON.stringify(helper));
 writeFileSync(url,code);
 let cleanup;
 try{
  const {startScreencast}=await import(url.href),requests=[],frames=[],changes=[];
  const client={on(){},removeListener(){},async send(method,params){requests.push([method,params.format]);if(method==='Page.captureScreenshot'){if(params.format==='bgra')throw Error('engine lost raw');return {data:'frame-'+params.format};}return {};}};
  const result=await startScreencast(client,{width:100,height:100,format:'bgra',fallbackFormat:'jpeg',onFrame:s=>frames.push(s),onFormatChange:f=>changes.push(f)});cleanup=result.cleanup;
  await Bun.sleep(650);
  expect(changes).toEqual(['jpeg']);expect(frames).toContain('frame-jpeg');expect(frames).toContain('frame-png');
  expect(requests.filter(([method,format])=>method==='Page.captureScreenshot'&&format==='bgra')).toHaveLength(1);
  await result.forceCapture();expect(frames.at(-1)).toBe('frame-jpeg');
 }finally{cleanup?.();rmSync(url,{force:true});}
});

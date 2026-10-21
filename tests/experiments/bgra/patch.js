import {patchRenderer as rawRenderer} from '../raw-file/patch.js';

export function patchRenderer(source){
  source=rawRenderer(source)
    .replaceAll("format === 'rgba'","(format === 'rgba' || format === 'bgra')")
    .replace('function rawFile(bytes, width, height)', "function rawFile(bytes, width, height, format)")
    .replace("format:'rgba'",'format').replace("+ '.rgba'","+ '.' + format");
  for(const expression of ['Buffer.from(rgba.buffer)','Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)'])
    source=source.replace(`rawFile(${expression}, outWidth, outHeight)`,`rawFile(${expression}, outWidth, outHeight, format)`);
  source=source.replace('const rgba = new Uint32Array(pixels.length);',"const rgba = format === 'bgra' ? pixels : new Uint32Array(pixels.length);")
    .replace('for (let i = 0; i < pixels.length; i++) {',"for (let i = 0; format === 'rgba' && i < pixels.length; i++) {");
  return source.replace('colorType:CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul',
    "colorType:format === 'bgra' ? CK.ColorType.BGRA_8888 : CK.ColorType.RGBA_8888,alphaType:CK.AlphaType.Unpremul")
    .replace('const rgba = image.readPixels(0,0,info);',`const rgba = format === 'bgra' ? (()=>{
      const memory=CK.Malloc(Uint8Array,info.width*info.height*4);
      try {
        if(!image.readPixels(0,0,info,memory,info.width*4))throw Error('BGRA readback failed');
        return memory.toTypedArray().slice();
      }finally{CK.Free(memory);}
    })() : image.readPixels(0,0,info);`);
}

// Input is ordinary PNG-capable Casty, preserving its original fallback path.
export function patchKitty(source){
  source=`import {BgraProbe,BGRA_FORMAT} from './bgra-protocol.js';\n`+source;
  source=source.replace('let selectedTransport = null;',`let selectedTransport = null;
let preferredFormat='png';
const bgra=new BgraProbe({
 write:seq=>process.stdout.write(wrapKitty(seq)),
 createFile:bytes=>{const p=join(tmpdir(),'casty-bgra-probe-'+process.pid+'-'+Date.now());writeFileSync(p,bytes,{flag:'wx',mode:0o600});return p;},
 removeFile:p=>unlinkSync(p),
});
export async function queryBgra(){preferredFormat=await bgra.query();return preferredFormat;}`);
  source=source.replace('const transport = new KittyTransport({','const transport = new KittyTransport({\n  onReply:(id,message)=>bgra.reply(id,message),');
  source=source.replace('  transport.stop();','  transport.stop(); bgra.stop();');
  source=source.replace('export function sendFrame(base64Data) {',`export function sendFrame(base64Data) {
  if(base64Data.startsWith('{')){
    const started=performance.now();
    const frame=JSON.parse(base64Data);
    if(preferredFormat==='png'||detectTransport()!=='file'||frame.format!==preferredFormat||frame.bytes!==frame.width*frame.height*4)
      throw Error('Unnegotiated or invalid BGRA frame');
    const cr=_cols&&_rows?\`,c=\${_cols},r=\${_rows}\`:'';
    process.stdout.write(CURSOR_HOME+wrapKitty(\`\\x1b_Ga=T,f=\${frame.format==='bgra'?BGRA_FORMAT:32},s=\${frame.width},v=\${frame.height},t=t,q=2,C=1,i=1\${cr};\${Buffer.from(frame.path).toString('base64')}\\x1b\\\\\`));
    if(typeof record==='function')record('send-frame',performance.now()-started,{descriptorBytes:base64Data.length});
    return;
  }`);
  return source;
}

export function patchTransport(source){
  return source.replace('onChange = () => {}','onReply = () => {}, onChange = () => {}')
   .replace('timeout, onChange });','timeout, onChange, onReply });')
   .replace('      if (reply && this.pending', '      if(reply)this.onReply(Number(reply[1]),reply[2]);\n      if (reply && this.pending');
}

export function patchImages(source){
  return source.replace('image.format === 24 || image.format === 32','image.format === 24 || image.format === 32 || image.format === 0x42475241')
   .replace('colorType: CanvasKit.ColorType.RGBA_8888,','colorType: image.format === 0x42475241 ? CanvasKit.ColorType.BGRA_8888 : CanvasKit.ColorType.RGBA_8888,');
}

export function patchBrowser(source){
  source="import {isRaw,validateRawFrame} from './capture-format.js';\n"+source;
  source=source.replace("format = 'png', quality = 85 }", "format = 'png', quality = 85, fallbackFormat = 'png', onFormatChange = () => {} }");
  source=source.replace('const refineOpts =', 'let refineOpts =');
  const marker='  // PNG refinement: capture one lossless frame after activity settles';
  if(!source.includes(marker))throw Error('Missing screencast capture insertion point');
  source=source.replace(marker,`  async function captureFrame() {
    try {
      const result=await client.send('Page.captureScreenshot',fastOpts,SCREENSHOT_TIMEOUT);
      if(isRaw(format))validateRawFrame(result?.data,format);
      return result;
    }catch(error){
      if(!isRaw(format))throw error;
      // Retire raw for this connection; retain the user's original codec policy.
      format=fallbackFormat;fastOpts.format=format;
      if(format==='jpeg')fastOpts.quality=quality;else delete fastOpts.quality;
      refineOpts=format==='jpeg'?{format:'png',captureBeyondViewport:false}:null;
      onFormatChange(format);
      await client.send('Page.startScreencast',{
        ...screencastOpts,format,...(format==='jpeg'?{quality:30}:{})
      }).catch(()=>{});
      return client.send('Page.captureScreenshot',fastOpts,SCREENSHOT_TIMEOUT);
    }
  }

`+marker);
  // Replace the two consumers, not the helper's own client.send calls.
  source=source.replaceAll("const { data } = await client.send('Page.captureScreenshot', fastOpts, SCREENSHOT_TIMEOUT);",'const { data } = await captureFrame();');
  source=source.replace('if (previewNextFrame && data)', 'if (!isRaw(format) && previewNextFrame && data)');
  source=source.replace('  const screencastOpts = {\n    format,',"  const screencastOpts = {\n    format: isRaw(format) ? 'png' : format,");
  return source;
}

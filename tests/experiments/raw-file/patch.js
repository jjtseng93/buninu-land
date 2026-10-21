// Experimental only: patch copies of the existing RGBA renderer and test Casty.
// CDP data contains a JSON descriptor, NOT standard captureScreenshot image data.
export function patchRenderer(source) {
  source = `import {mkdtempSync,writeFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
` + source;
  source = source.replace('  let full, preview, closed = false;', `  let full, preview, closed = false;
  let rawDirectory, rawSequence = 0;
  function rawFile(bytes, width, height) {
    rawDirectory ??= mkdtempSync(join(tmpdir(), 'tty-graphics-protocol-land-'));
    // Never overwrite a frame still owned by the receiving terminal.
    if (readdirSync(rawDirectory).length >= 16) throw Error('Raw frame consumer stalled');
    const path = join(rawDirectory, String(++rawSequence) + '.rgba');
    writeFileSync(path, bytes, {flag:'wx',mode:0o600});
    return JSON.stringify({path,width,height,format:'rgba',bytes:bytes.byteLength});
  }`);
  source = source.replace('      direct.close();', "      direct.close();\n      if(rawDirectory)rmSync(rawDirectory,{recursive:true,force:true});");
  for (const expression of ['Buffer.from(rgba.buffer)', 'Buffer.from(rgba.buffer, rgba.byteOffset, rgba.byteLength)']) {
    const old = `${expression}.toString('base64')`;
    if (!source.includes(old)) throw Error('Missing raw capture branch: '+old);
    source = source.replace(old, `rawFile(${expression}, outWidth, outHeight)`);
  }
  return source.replaceAll(':raw-base64', ':raw-file-write');
}

export function patchKitty(source) {
  const start = source.indexOf('function sendFrameFile(base64Data) {');
  const end = source.indexOf('// Inline mode', start);
  if (start < 0 || end < 0) throw Error('Missing Kitty file function');
  return source.slice(0,start) + `function sendFrameFile(data) {
  const frame=JSON.parse(data);
  if(frame.format!=='rgba'||frame.bytes!==frame.width*frame.height*4)throw Error('Invalid raw descriptor');
  const crFile = _cols && _rows ? \`,c=\${_cols},r=\${_rows}\` : '';
  const path=Buffer.from(frame.path).toString('base64');
  const seq = \`\\x1b_Ga=T,f=32,s=\${frame.width},v=\${frame.height},t=t,q=2,C=1,i=1\${crFile};\${path}\\x1b\\\\\`;
  process.stdout.write(\`\${CURSOR_HOME}\${wrapKitty(seq)}\`);
}

` + source.slice(end);
}

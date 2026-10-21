import {openSync,fstatSync,closeSync} from 'node:fs';
import {isAbsolute} from 'node:path';

export const isRaw = format => format === 'bgra' || format === 'rgba';
export function standardFormat(configured='auto',transport='inline') {
  return configured === 'auto' ? (transport === 'file' ? 'jpeg' : 'png') : configured;
}
export function validateRawFrame(data,format) {
  const frame=JSON.parse(data);
  if(!isRaw(format)||frame?.format!==format||typeof frame.path!=='string'||!isAbsolute(frame.path)
    ||!Number.isInteger(frame.width)||!Number.isInteger(frame.height)||frame.width<1||frame.height<1
    ||frame.width*frame.height>16777216||frame.bytes!==frame.width*frame.height*4)
    throw Error('Invalid raw frame descriptor');
  const fd=openSync(frame.path,'r');
  try{const stat=fstatSync(fd);if(!stat.isFile()||stat.size!==frame.bytes)throw Error('Invalid raw frame file');}
  finally{closeSync(fd);}
  return frame;
}

// Raw has priority even over an explicit encoded-format setting. Preserve that
// setting as fallback. Probe once per connection and reuse the successful frame.
export async function negotiateCapture(client,{configured='auto',transport='inline',queryPreference,timeout=5000}) {
  const fallbackFormat=standardFormat(configured,transport);
  if(transport!=='file')return {format:fallbackFormat,fallbackFormat};
  try{
    const preferred=await queryPreference();
    if(!isRaw(preferred))return {format:fallbackFormat,fallbackFormat};
    let timer;
    const result=await Promise.race([
      client.send('Page.captureScreenshot',{format:preferred,optimizeForSpeed:true,captureBeyondViewport:false},timeout),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Raw probe timed out')),timeout);}),
    ]).finally(()=>clearTimeout(timer));
    validateRawFrame(result?.data,preferred);
    return {format:preferred,fallbackFormat,firstFrame:result.data};
  }catch{return {format:fallbackFormat,fallbackFormat};}
}

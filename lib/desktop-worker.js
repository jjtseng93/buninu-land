// Native Bun execution, intentionally NOT a sandbox. Only the main compositor
// owns wallpaper state and modal UI; synchronous dialogs block this worker only.
import {parentPort} from 'node:worker_threads';
let next=0,tail=Promise.resolve();const pending=new Map();
function request(method,args){if(pending.size>=128)return Promise.reject(Error('Desktop call queue is full'));return new Promise((resolve,reject)=>{const id=++next;pending.set(id,{resolve,reject});parentPort.postMessage({type:'call',id,method,args});});}
globalThis.setWallpaper=path=>request('setWallpaper',[path]);
function dialog(type,message='',defaultPrompt=''){
  const buffer=new SharedArrayBuffer(12,{maxByteLength:64*1024*1024}),state=new Int32Array(buffer,0,3);
  parentPort.postMessage({type:'dialog',buffer,request:{type,message:String(message),defaultPrompt:String(defaultPrompt)}});
  while(Atomics.load(state,0)===0)Atomics.wait(state,0,0);
  if(type==='alert')return undefined;
  if(type==='confirm')return Boolean(state[2]);
  if(!state[2])return null;
  const text=new Uint16Array(buffer,12,state[1]);let value='';
  for(let i=0;i<text.length;i+=8192)value+=String.fromCharCode(...text.subarray(i,i+8192));
  return value;
}
globalThis.alert=(message='')=>dialog('alert',message);
globalThis.confirm=(message='')=>dialog('confirm',message);
globalThis.prompt=(message='',value='')=>dialog('prompt',message,value);
parentPort.on('message',message=>{
  if(message.type==='reply'){
    const entry=pending.get(message.id);if(!entry)return;pending.delete(message.id);
    message.error?entry.reject(Error(message.error)):entry.resolve(message.value);return;
  }
  if(message.type!=='evaluate')return;
  tail=tail.then(async()=>{
    try {
      // Indirect eval gives classic native global scope, retained across calls.
      const value=await (0,eval)(message.expression);
      try{parentPort.postMessage({type:'result',id:message.id,value});}
      catch{parentPort.postMessage({type:'result',id:message.id,error:'Evaluation result is not serializable'});}
    }catch(error){parentPort.postMessage({type:'result',id:message.id,error:String(error?.stack??error)});}
  });
});

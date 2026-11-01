import {test,expect} from 'bun:test';
import {WindowsSocketPath} from '../lib/win32-socket-path.js';
function system(){
 const files=new Map(),handles=new Map(),deleted=[],calls=[];let next=1,error=0;
 const text=b=>b.toString('utf16le').replace(/\0.*$/s,'');
 const k={
  CreateFileW(path,access,share,security,mode,flags){path=text(path);calls.push({path,access,share,mode,flags});
   if([...handles.values()].includes(path)){error=32;return -1}
   const h=next++;handles.set(h,path);return h},
  CloseHandle(h){handles.delete(h);return 1},GetLastError:()=>error,
  FindFirstFileW(path,data){const type=files.get(text(path));if(!type){error=2;return -1}
   data.writeUInt32LE(type==='file'?0x80:0x400,0);data.writeUInt32LE(type==='socket'?0x80000023:0xa000000c,36);return 99},
  FindClose:()=>1,DeleteFileW(path){path=text(path);files.delete(path);deleted.push(path);return 1},
 };return {k,files,handles,deleted,calls};
}
test('live owner prevents reuse before any endpoint removal',()=>{
 const s=system(),owner=new WindowsSocketPath('wayland-buninu',s.k);s.files.set(owner.path,'socket');
 try{let error;try{new WindowsSocketPath(owner.path,s.k)}catch(e){error=e}
  expect(error.code).toBe('EADDRINUSE');expect(s.deleted).toEqual([]);expect(s.calls[0].share).toBe(0);
 }finally{owner.close()}
});
test('normal close and abandoned handle both allow reclaiming the original socket name',()=>{
 const s=system();for(const crashed of [false,true]){
  const owner=new WindowsSocketPath('wayland-buninu',s.k);s.files.set(owner.path,'socket');
  if(crashed)s.handles.clear();else {owner.removeSocket();owner.close()}
  const replacement=new WindowsSocketPath(owner.path,s.k);replacement.removeSocket();replacement.close();
  expect(s.files.has(owner.path)).toBe(false);expect(s.handles.size).toBe(0);
 }
 expect(s.deleted).toEqual(['wayland-buninu','wayland-buninu']);
});
test('cleanup never deletes unrelated files or symlinks, and close is idempotent',()=>{
 const s=system();for(const kind of ['file','symlink']){
  const owner=new WindowsSocketPath('wayland-buninu',s.k);s.files.set(owner.path,kind);
  expect(()=>owner.removeSocket()).toThrow('not an AF_UNIX socket');owner.close();owner.close();
 }
 expect(s.deleted).toEqual([]);expect(s.handles.size).toBe(0);
});
test.skipIf(process.platform==='win32')('socket lock DLL is guarded before dlopen on other platforms',async()=>{
 try{await import('../lib/win32-socket-lock.js');throw Error('unexpected success')}catch(e){expect(e.message).toBe('Windows socket locks require Windows')}
});

test.skipIf(process.platform!=='win32')('native Windows socket close reuses the original name repeatedly',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');
 const {join}=await import('node:path');const {tmpdir}=await import('node:os');
 const {lockSocketPath}=await import('../lib/win32-socket-lock.js');
 const directory=mkdtempSync(join(tmpdir(),'land-win-socket-')),path=join(directory,'wayland-buninu');
 let owner,server;
 try{
  for(let i=0;i<3;i++){
   owner=lockSocketPath(path);owner.removeSocket();
   server=Bun.listen({unix:path,socket:{open:s=>s.end(),data(){}}});
   expect(()=>lockSocketPath(path)).toThrow('already locked');
   server.stop(true);server=null;owner.removeSocket();owner.close();owner=null;
  }
 }finally{server?.stop(true);if(owner){try{owner.removeSocket()}finally{owner.close()}}rmSync(directory,{recursive:true,force:true})}
});

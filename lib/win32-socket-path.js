// Kept separate from DLL loading so ownership/cleanup can be tested anywhere.
const wide=s=>Buffer.from(s+'\0','utf16le');
const invalid=h=>!h||h===-1||h===-1n||h===0xffffffffffffffffn||h===Number(0xffffffffffffffffn);
export class WindowsSocketPath {
 constructor(path,k){
  this.path=path;this.k=k;
  // No sharing (including delete sharing): a live owner cannot have its lock
  // inode replaced. Windows closes the handle automatically after a crash.
  this.handle=k.CreateFileW(wide(path+'.lock'),0xc0000000,0,null,4,0x200080,null);
  if(invalid(this.handle)){
   const code=k.GetLastError();
   throw Object.assign(Error(code===32?'Wayland socket is already locked':`Cannot open Wayland socket lock: Win32 error ${code}`),{code:code===32?'EADDRINUSE':'ELOCK'});
  }
 }
 removeSocket(){
  if(this.closed)throw Error('Socket lock is closed');
  const k=this.k,path=wide(this.path),attributes=k.GetFileAttributesW(path);
  // Check the DWORD sentinel before inspecting a HANDLE. In particular, a
  // manually removed endpoint needs no cleanup and must never reach deletion.
  if(attributes===0xffffffff){
   const code=k.GetLastError();if(code===2||code===3)return;
   throw Error(`Cannot inspect Wayland socket ${this.path}: Win32 error ${code}`);
  }
  const data=Buffer.alloc(592),search=k.FindFirstFileW(path,data);
  if(invalid(search)){
   const code=k.GetLastError();if(code===2||code===3)return;
   throw Error(`Cannot inspect Wayland socket: Win32 error ${code}`);
  }
  k.FindClose(search);
  // Windows AF_UNIX endpoints are reparse points, not ordinary files. Never
  // remove an unrelated file, directory, symlink or other reparse point.
  if(!(data.readUInt32LE(0)&0x400)||data.readUInt32LE(36)!==0x80000023)
   throw Error(`Socket path is not an AF_UNIX socket: ${this.path} (attributes=0x${attributes.toString(16)}, findAttributes=0x${data.readUInt32LE(0).toString(16)}, reparseTag=0x${data.readUInt32LE(36).toString(16)})`);
  if(!k.DeleteFileW(wide(this.path))){const code=k.GetLastError();if(code!==2&&code!==3)throw Error(`Cannot remove Wayland socket: Win32 error ${code}`)}
 }
 close(){if(this.closed)return;this.closed=true;this.k.CloseHandle(this.handle)}
}

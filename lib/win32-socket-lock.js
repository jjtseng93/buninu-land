import {dlopen} from 'bun:ffi';
import {WindowsSocketPath} from './win32-socket-path.js';
if(process.platform!=='win32')throw Error('Windows socket locks require Windows');
const sig=(args,returns)=>({args,returns});
const {symbols:k}=dlopen('kernel32.dll',{
 CreateFileW:sig(['ptr','u32','u32','ptr','u32','u32','ptr'],'ptr'),
 FindFirstFileW:sig(['ptr','ptr'],'ptr'),FindClose:sig(['ptr'],'i32'),
 DeleteFileW:sig(['ptr'],'i32'),CloseHandle:sig(['ptr'],'i32'),GetLastError:sig([],'u32'),
});
export const lockSocketPath=path=>new WindowsSocketPath(path,k);

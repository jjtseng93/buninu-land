import {dlopen} from 'bun:ffi';
import {WindowsSocketPath} from './win32-socket-path.js';
if(process.platform!=='win32')throw Error('Windows socket locks require Windows');
const sig=(args,returns)=>({args,returns});
const {symbols:k}=dlopen('kernel32.dll',{
 CreateFileW:sig(['ptr','u32','u32','ptr','u32','u32','ptr'],'i64'),
 GetFileAttributesW:sig(['ptr'],'u32'),
 FindFirstFileW:sig(['ptr','ptr'],'i64'),FindClose:sig(['i64'],'i32'),
 DeleteFileW:sig(['ptr'],'i32'),CloseHandle:sig(['i64'],'i32'),GetLastError:sig([],'u32'),
});
export const lockSocketPath=path=>new WindowsSocketPath(path,k);

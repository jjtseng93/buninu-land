// Only Windows loads kernel32; Linux/Android retain the SCM_RIGHTS transport.
const backend = await import(process.platform === 'win32' ? './transport-win32.js' : './transport-posix.js');
export const {libc,errno,Connection,Transport} = backend;

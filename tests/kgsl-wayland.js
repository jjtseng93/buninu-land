// Diagnostic workaround for matching custom AArch64 Mesa KGSL control flow.
// Derived from binary inspection, without reading/copying Termux X11 source.
// Changes only a private copy; Land itself still loads only libc through FFI.
import {patchKgsl} from './kgsl-patch.js';
import {mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const source=process.env.KGSL_EGL_LIBRARY??'/usr/lib/aarch64-linux-gnu/libEGL_mesa.so.0';
const bytes=Buffer.from(await Bun.file(source).arrayBuffer());
const objdump=process.env.OBJDUMP??'objdump';
const probe=Bun.spawnSync([objdump,'-d','--disassemble=dri2_initialize_wayland',source]);
if(probe.exitCode!==0)throw Error('AArch64-capable objdump is required: '+probe.stderr.toString());
const patch=patchKgsl(bytes,probe.stdout.toString());
console.error(`Verified KGSL branch: 0x${patch.address.toString(16)} -> 0x${patch.target.toString(16)}`);
if(process.argv.includes('--check-only'))process.exit(0);
// The hash only names the private cache; it is not an allowlist.
const hash=new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
const directory=join(tmpdir(),'buninu-kgsl-egl-'+hash.slice(0,12));
await mkdir(directory,{recursive:true});
await Bun.write(join(directory,'libEGL_mesa.so.0'),patch.bytes);
const env={...process.env,MESA_LOADER_DRIVER_OVERRIDE:'kgsl',TU_DEBUG:'noconform',
 LD_LIBRARY_PATH:directory+(process.env.LD_LIBRARY_PATH?':'+process.env.LD_LIBRARY_PATH:''),
 XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR??'/tmp',WAYLAND_DISPLAY:process.env.WAYLAND_DISPLAY??'wayland-buninu',
 vblank_mode:process.env.vblank_mode??'0'};
delete env.GALLIUM_DRIVER;delete env.LIBGL_ALWAYS_SOFTWARE;delete env.MESA_VK_WSI_DEBUG;
console.error('Experimental private EGL copy:',directory,'; Land requires --linear-dmabuf');
const args=process.argv.slice(2);
const child=Bun.spawn(['glmark2-wayland',...(args.length?args:['--run-forever','--annotate'])],{env,stdin:'inherit',stdout:'inherit',stderr:'inherit'});
const interrupt=()=>child.kill('SIGINT'),terminate=()=>child.kill('SIGTERM');
process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
try{process.exitCode=await child.exited;}finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}

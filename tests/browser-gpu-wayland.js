// Manual proot experiment: GPU WebGL with software browser presentation to Land.
// Reuses the existing private KGSL EGL patch; does not change system libraries.
import {mkdtemp, mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {patchKgsl} from './kgsl-patch.js';

const [browser, ...args] = process.argv.slice(2);
if (!['chromium', 'firefox-esr'].includes(browser)) {
  console.log('Usage: bun tests/browser-gpu-wayland.js chromium|firefox-esr [browser arguments]\nSet WAYLAND_DISPLAY to the running Land socket; Land needs --linear-dmabuf.\nUses an isolated temporary browser profile and requires the existing PCI stub.');
  process.exit(browser && !['-h', '--help'].includes(browser) ? 1 : 0);
}
const source = process.env.KGSL_EGL_LIBRARY ?? '/usr/lib/aarch64-linux-gnu/libEGL_mesa.so.0';
const bytes = Buffer.from(await Bun.file(source).arrayBuffer());
const disassembly = Bun.spawnSync([process.env.OBJDUMP ?? 'objdump', '-d', '--disassemble=dri2_initialize_wayland', source]);
if (disassembly.exitCode !== 0) throw Error(disassembly.stderr.toString());
const patch = patchKgsl(bytes, disassembly.stdout.toString());
const hash = new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0,12);
const directory = join(tmpdir(), 'buninu-kgsl-egl-' + hash);
await mkdir(directory, {recursive:true});
await Bun.write(join(directory, 'libEGL_mesa.so.0'), patch.bytes);
const stub = process.env.CHROMIUM_PCI_STUB ?? '/usr/local/lib/chromium-pci-stub';
if (!await Bun.file(join(stub, 'libpci.so.3')).exists())
  throw Error('Existing PCI stub missing: ' + stub + '/libpci.so.3');
const profile = await mkdtemp(join(tmpdir(), 'land-gpu-' + browser + '-'));
const env = {...process.env,
  XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR ?? tmpdir(),
  WAYLAND_DISPLAY:process.env.WAYLAND_DISPLAY ?? 'wayland-buninu',
  MESA_LOADER_DRIVER_OVERRIDE:'kgsl', TU_DEBUG:'noconform', vblank_mode:'0',
  LD_LIBRARY_PATH:[stub, directory, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};
delete env.GALLIUM_DRIVER;
delete env.LIBGL_ALWAYS_SOFTWARE;
delete env.MESA_VK_WSI_DEBUG;
let flags;
if (browser === 'chromium') {
  flags = ['--no-sandbox', '--disable-gpu-sandbox', '--ozone-platform=wayland', '--use-gl=angle', '--use-angle=gles', '--ignore-gpu-blocklist', '--user-data-dir=' + profile, '--no-first-run', '--disable-dev-shm-usage', '--window-size=1024,768'];
} else {
  Object.assign(env, {MOZ_ENABLE_WAYLAND:'1', GDK_BACKEND:'wayland', EGL_PLATFORM:'wayland', MOZ_DISABLE_CONTENT_SANDBOX:'1', MOZ_DISABLE_RDD_SANDBOX:'1', MOZ_DISABLE_GPU_SANDBOX:'1'});
  const prefs = {'browser.shell.checkDefaultBrowser':false, 'browser.startup.homepage_override.mstone':'ignore', 'browser.aboutwelcome.enabled':false, 'webgl.force-enabled':true, 'gfx.webrender.software':true, 'gfx.egl.prefer-gles.enabled':true, 'widget.dmabuf.force-enabled':true, 'webgl.out-of-process':false};
  await Bun.write(join(profile, 'user.js'), Object.entries(prefs).map(([key,value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`).join('\n') + '\n');
  flags = ['--no-remote', '--profile', profile];
}
console.error('Experimental browser profile:', profile, '\nWayland socket:', env.WAYLAND_DISPLAY);
console.error('Browser sandbox disabled for this proot experiment. Requests GPU WebGL with software presentation; verify the page renderer.');
const child = Bun.spawn([browser, ...flags, ...args, 'https://webglsamples.org/aquarium/aquarium.html'], {env, stdin:'inherit', stdout:'inherit', stderr:'inherit'});
const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
try { process.exitCode = await child.exited; }
finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }

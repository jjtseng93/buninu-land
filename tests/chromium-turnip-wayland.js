// Manual ANGLE Vulkan / Turnip experiment. No EGL binary patch or installations.
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

const args = process.argv.slice(2);
if (args.includes('-h') || args.includes('--help')) {
  console.log('Usage: bun tests/chromium-turnip-wayland.js [Chromium arguments]\nSet WAYLAND_DISPLAY to Land. VK_DRIVER_FILES selects the Turnip ICD JSON.\nUses an isolated profile and the existing CHROMIUM_PCI_STUB directory.');
  process.exit(0);
}
const stub = process.env.CHROMIUM_PCI_STUB ?? '/usr/local/lib/chromium-pci-stub';
const icd = process.env.VK_DRIVER_FILES ?? '/usr/share/vulkan/icd.d/freedreno_icd.aarch64.json';
for (const path of [join(stub, 'libpci.so.3'), ...icd.split(':')])
  if (!await Bun.file(path).exists()) throw Error('Missing existing prerequisite: ' + path);
const profile = await mkdtemp(join(tmpdir(), 'land-turnip-chromium-'));
const env = {...process.env,
  XDG_RUNTIME_DIR:process.env.XDG_RUNTIME_DIR ?? tmpdir(),
  WAYLAND_DISPLAY:process.env.WAYLAND_DISPLAY ?? 'wayland-buninu',
  TU_DEBUG:'noconform', VK_DRIVER_FILES:icd,
  LD_LIBRARY_PATH:[stub, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
};
for (const key of ['VK_ICD_FILENAMES', 'MESA_LOADER_DRIVER_OVERRIDE', 'GALLIUM_DRIVER', 'LIBGL_ALWAYS_SOFTWARE', 'MESA_VK_WSI_DEBUG']) delete env[key];
console.error('Experimental profile:', profile, '\nTurnip ICD:', icd, '\nWayland socket:', env.WAYLAND_DISPLAY);
console.error('Browser sandbox disabled for this proot experiment; verify renderer and visible frames.');
const child = Bun.spawn(['chromium', '--no-sandbox', '--disable-gpu-sandbox',
  '--ozone-platform=wayland', '--use-gl=angle', '--use-angle=vulkan', '--ignore-gpu-blocklist',
  '--user-data-dir=' + profile, '--no-first-run', '--disable-dev-shm-usage', '--window-size=1024,768',
  ...args, 'https://webglsamples.org/aquarium/aquarium.html'], {env, stdin:'inherit', stdout:'inherit', stderr:'inherit'});
const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
process.on('SIGINT', interrupt); process.on('SIGTERM', terminate);
try { process.exitCode = await child.exited; }
finally { process.off('SIGINT', interrupt); process.off('SIGTERM', terminate); }

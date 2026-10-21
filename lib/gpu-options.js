// A client-acceleration preset, not GPU composition. Explicit engine options
// override preset defaults regardless of where --gpu appears.
export function expandGpuOptions(args) {
  const result = [];
  let enabled = false, device = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--gpu') {
      enabled = true;
      if (args[i + 1]?.startsWith('/')) device = args[++i];
    } else if (arg.startsWith('--gpu=')) {
      enabled = true;
      device = arg.slice('--gpu='.length);
      if (!device.startsWith('/')) throw Error('Use --gpu or --gpu=/absolute/path/to/renderD128');
    } else {
      result.push(arg);
    }
  }
  if (!enabled) return result;
  result.push('--linear-dmabuf', '--lazy-dmabuf');
  if (!result.some(arg => arg.startsWith('--poll-interval='))) result.push('--poll-interval=2');
  if (device && !result.some(arg => arg === '--drm-device' || arg.startsWith('--drm-device='))) result.push(`--drm-device=${device}`);
  return result;
}

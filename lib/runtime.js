import { isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';

// Keep the socket directly in the explicitly selected runtime/temp directory.
export function runtimeDirectory(env = process.env) {
  const directory = env.XDG_RUNTIME_DIR || env.TMPDIR || tmpdir();
  if (!isAbsolute(directory)) throw Error('XDG_RUNTIME_DIR / TMPDIR must be an absolute path');
  return directory;
}

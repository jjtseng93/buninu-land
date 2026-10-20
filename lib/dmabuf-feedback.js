import * as fs from 'node:fs';
import { join } from 'node:path';
import { linearFormats } from './dmabuf.js';

// Native-endian dev_t/format tables on the supported little-endian LP64 ABIs.
// A render node is a client allocation preference, not a GPU compositor backend.
export function openDmabufFeedback(path, directory, io = fs) {
  let deviceFd, tableFd, temporary;
  try {
    deviceFd = io.openSync(path, io.constants.O_RDWR | io.constants.O_CLOEXEC);
    const stat = io.fstatSync(deviceFd, { bigint: true });
    const major = ((stat.rdev >> 8n) & 0xfffn) | ((stat.rdev >> 32n) & 0xfffff000n);
    const minor = (stat.rdev & 0xffn) | ((stat.rdev >> 12n) & 0xffffff00n);
    if (!stat.isCharacterDevice() || major !== 226n || minor < 128n || minor > 255n)
      throw Error('--drm-device must name a DRM render node');
    const device = Buffer.alloc(8);
    device.writeBigUInt64LE(stat.rdev);
    const table = Buffer.alloc(linearFormats.length * 16);
    const indices = Buffer.alloc(linearFormats.length * 2);
    linearFormats.forEach((format, i) => {
      table.writeUInt32LE(format, i * 16); // padding and LINEAR modifier remain zero
      indices.writeUInt16LE(i, i * 2);
    });
    io.mkdirSync(directory, { recursive: true, mode: 0o700 });
    temporary = io.mkdtempSync(join(directory, '.land-dmabuf-'));
    const file = join(temporary, 'formats');
    io.writeFileSync(file, table, { flag: 'wx', mode: 0o600 });
    tableFd = io.openSync(file, io.constants.O_RDONLY | io.constants.O_CLOEXEC);
    io.unlinkSync(file);
    io.rmdirSync(temporary); temporary = null;
    let closed = false;
    return {
      path, device, tableFd, size: table.length, indices,
      send(event) {
        // Match Hyprland's default feedback order; no scanout tranche.
        event('format_table', tableFd, table.length);
        event('main_device', device);
        event('tranche_target_device', device);
        event('tranche_flags', 0);
        event('tranche_formats', indices);
        event('tranche_done');
        event('done');
      },
      close() {
        if (closed) return;
        closed = true; io.closeSync(tableFd); io.closeSync(deviceFd);
      },
    };
  } catch (error) {
    if (tableFd !== undefined) io.closeSync(tableFd);
    if (deviceFd !== undefined) io.closeSync(deviceFd);
    if (temporary) io.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

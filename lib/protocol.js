// Interpret upstream XML with Bun's built-in parser at runtime; no generated bindings.
import { readFileSync } from 'node:fs';
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const attrs = node => Object.fromEntries(Object.entries(node).filter(([k]) => k.startsWith('@')).map(([k,v]) => [k.slice(1), v]));
export const interfaces = new Map();
for (const file of ['wayland', 'xdg-shell', 'viewporter', 'fractional-scale-v1', 'linux-dmabuf-v1', 'ext-data-control-v1', 'wlr-data-control-unstable-v1']) {
  const xml = Bun.XML.parse(readFileSync(new URL(`../protocols/${file}.xml`, import.meta.url), 'utf8'));
  for (const node of list(xml.protocol.interface)) {
    const spec = { ...attrs(node) };
    for (const [tag, key] of [['request', 'requests'], ['event', 'events']])
      spec[key] = list(node[tag]).map(message => ({ ...attrs(message), args: list(message.arg).map(attrs) }));
    interfaces.set(spec.name, spec);
  }
}
export function decode(spec, bytes, fds) {
  let offset = 8, fdOffset = 0;
  const values = [];
  const word = () => { if (offset + 4 > bytes.length) throw Error('Truncated argument'); const v = bytes.readUInt32LE(offset); offset += 4; return v; };
  for (const arg of spec.args) {
    if (arg.type === 'fd') { if (fdOffset === fds.length) return null; values.push(fds[fdOffset++]); continue; }
    if (arg.type === 'new_id' && !arg.interface) {
      const n = word(); if (!n || offset + n > bytes.length || bytes[offset + n - 1]) throw Error('Invalid interface string');
      values.push(bytes.toString('utf8', offset, offset + n - 1)); offset += (n + 3) & ~3;
      values.push(word(), word()); continue;
    }
    const v = word();
    if (arg.type === 'string' || arg.type === 'array') {
      if (offset + v > bytes.length) throw Error('Truncated array/string');
      if (arg.type === 'string' && v && bytes[offset + v - 1]) throw Error('Unterminated string');
      values.push(arg.type === 'string' ? (v ? bytes.toString('utf8', offset, offset + v - 1) : null) : bytes.subarray(offset, offset + v));
      offset += (v + 3) & ~3;
    } else values.push(arg.type === 'fixed' ? (v | 0) / 256 : arg.type === 'int' ? v | 0 : v);
  }
  if (offset !== bytes.length) throw Error('Invalid message size');
  fds.splice(0, fdOffset);
  return values;
}
export function encode(id, iface, event, values) {
  const events = interfaces.get(iface).events, opcode = events.findIndex(e => e.name === event);
  if (opcode < 0) throw Error(`Unknown event ${iface}.${event}`);
  const parts = [Buffer.alloc(8)];
  events[opcode].args.forEach((arg, i) => {
    const value = values[i];
    if (arg.type === 'fd') return; // SCM_RIGHTS carries descriptors outside the wire bytes.
    if (arg.type === 'string' || arg.type === 'array') {
      const b = arg.type === 'string' ? (value == null ? Buffer.alloc(0) : Buffer.from(value + '\0')) : Buffer.from(value);
      const p = Buffer.alloc(4 + ((b.length + 3) & ~3)); p.writeUInt32LE(b.length); b.copy(p, 4); parts.push(p);
    } else { const p = Buffer.alloc(4); p.writeUInt32LE((arg.type === 'fixed' ? Math.round(Number(value) * 256) : Number(value)) >>> 0); parts.push(p); }
  });
  const result = Buffer.concat(parts); result.writeUInt32LE(id); result.writeUInt32LE((result.length << 16) | opcode, 4); return result;
}

import { Transport, libc } from './transport.js';
import { interfaces, decode, encode } from './protocol.js';

const MAX_POOL = 256 * 1024 * 1024;
const globals = [['wl_compositor', 4], ['wl_shm', 1], ['xdg_wm_base', 1], ['wl_output', 2], ['wl_seat', 1]];
export class Compositor {
  constructor({ socket, width = 800, height = 600 }) {
    this.width = width; this.height = height; this.surfaces = new Set(); this.clients = new Set(); this.serial = 1; this.frames = 0;
    this.transport = new Transport(socket, connection => this.clients.add(new Client(this, connection)));
    this.timer = setInterval(() => this.present(), 16);
  }
  present() {
    let changed = false;
    for (const surface of this.surfaces) {
      if (surface.dirty) { changed = true; surface.dirty = false; }
      for (const callback of surface.callbacks.splice(0)) {
        surface.client.event(callback, 'done', Math.floor(performance.now()) >>> 0); surface.client.destroy(callback);
      }
    }
    if (changed) { this.frames++; this.onFrame?.(); }
  }
  close() { clearInterval(this.timer); this.transport.close(); }
}
class Client {
  constructor(compositor, connection) {
    this.compositor = compositor; this.connection = connection; this.objects = new Map(); this.pools = new Set();
    this.add(1, 'wl_display', 1);
    connection.onData = () => this.read();
    connection.onClose = () => {
      for (const object of [...this.objects.values()]) this.destroy(object, false);
      for (const pool of this.pools) libc.close(pool.fd);
      this.pools.clear(); compositor.clients.delete(this); compositor.onFrame?.();
    };
  }
  add(id, iface, version = 1, extra = {}) {
    if (!id || id >= 0xff000000 || this.objects.has(id) || this.objects.size >= 8192) throw Error('Invalid new object ID');
    const object = { id, iface, version, client: this, ...extra }; this.objects.set(id, object); return object;
  }
  object(id, iface) {
    const object = this.objects.get(id); if (!object || (iface && object.iface !== iface)) throw Error(`Invalid object ${id} (${iface})`); return object;
  }
  event(object, event, ...args) {
    if (this.objects.has(object.id)) this.connection.send(encode(object.id, object.iface, event, args));
  }
  destroy(object, notify = true) {
    if (!this.objects.delete(object.id)) return;
    if (object.iface === 'wl_surface') {
      for (const callback of [...object.callbacks, ...(object.pending.callbacks ?? [])]) this.destroy(callback, notify);
      this.compositor.surfaces.delete(object); this.compositor.onFrame?.();
    }
    if (object.iface === 'xdg_toplevel') object.xdg.toplevel = null;
    if (object.iface === 'xdg_surface') object.surface.xdg = null;
    if (object.pool) { if (--object.pool.refs === 0) { libc.close(object.pool.fd); this.pools.delete(object.pool); } }
    if (notify && object.id !== 1) this.event(this.object(1), 'delete_id', object.id);
  }
  read() {
    const c = this.connection;
    while (c.input.length >= 8) {
      const id = c.input.readUInt32LE(), header = c.input.readUInt32LE(4), size = header >>> 16, opcode = header & 65535;
      if (size < 8 || size % 4) throw Error('Invalid wire header');
      if (c.input.length < size) return;
      const object = this.object(id), spec = interfaces.get(object.iface).requests[opcode];
      if (!spec || Number(spec.since ?? 1) > object.version) throw Error(`Invalid request ${object.iface}.${opcode}`);
      const args = decode(spec, c.input.subarray(0, size), c.fds); if (!args) return;
      c.input = c.input.subarray(size);
      if (process.env.BUNINU_LOG) console.error(object.iface, id, spec.name, args);
      try { this.request(object, spec.name, args); }
      catch (error) { this.event(this.object(1), 'error', id, 1, error.message); throw error; }
    }
  }
  request(o, name, a) {
    const add = (id, iface, extra) => this.add(id, iface, 1, extra);
    const comp = this.compositor;
    switch (`${o.iface}.${name}`) {
      case 'wl_display.sync': { const callback = add(a[0], 'wl_callback'); this.event(callback, 'done', comp.serial++); this.destroy(callback); return; }
      case 'wl_display.get_registry': {
        const registry = add(a[0], 'wl_registry');
        globals.forEach(([iface, version], i) => this.event(registry, 'global', i + 1, iface, version)); return;
      }
      case 'wl_registry.bind': {
        const [global, iface, version, id] = a, offered = globals[global - 1];
        if (!offered || iface !== offered[0] || version < 1 || version > offered[1]) throw Error('Invalid global binding');
        const resource = this.add(id, iface, version);
        if (iface === 'wl_shm') { this.event(resource, 'format', 0); this.event(resource, 'format', 1); }
        if (iface === 'wl_seat') this.event(resource, 'capabilities', 0);
        if (iface === 'wl_output') {
          this.event(resource, 'geometry', 0, 0, 300, 200, 0, 'buninu', 'software', 0);
          this.event(resource, 'mode', 3, comp.width, comp.height, 60000);
          if (version >= 2) { this.event(resource, 'scale', 1); this.event(resource, 'done'); }
        }
        return;
      }
      case 'wl_compositor.create_surface': {
        const surface = this.add(a[0], 'wl_surface', o.version, { pending: {}, callbacks: [], pixels: null, scale: 1, transform: 0 });
        comp.surfaces.add(surface); return;
      }
      case 'wl_compositor.create_region': add(a[0], 'wl_region'); return;
      case 'wl_region.add': case 'wl_region.subtract': return;
      case 'wl_shm.create_pool': {
        const [id, fd, size] = a;
        if (size <= 0 || size > MAX_POOL) { libc.close(fd); throw Error('Invalid shm pool size'); }
        const pool = { fd, size, refs: 1 }; this.pools.add(pool);
        try { add(id, 'wl_shm_pool', { pool }); } catch (e) { this.pools.delete(pool); libc.close(fd); throw e; } return;
      }
      case 'wl_shm_pool.resize':
        if (a[0] < o.pool.size || a[0] > MAX_POOL) throw Error('Invalid pool resize'); o.pool.size = a[0]; return;
      case 'wl_shm_pool.create_buffer': {
        const [id, offset, width, height, stride, format] = a;
        if (offset < 0 || width <= 0 || height <= 0 || width > 8192 || height > 8192 || stride < width * 4 || stride % 4 || offset + stride * height > o.pool.size || ![0,1].includes(format)) throw Error('Invalid shm buffer');
        add(id, 'wl_buffer', { pool: o.pool, offset, width, height, stride, format }); o.pool.refs++; return;
      }
      case 'wl_surface.attach':
        o.pending.buffer = a[0] ? this.object(a[0], 'wl_buffer') : null; o.pending.offset = [a[1], a[2]]; return;
      case 'wl_surface.damage': case 'wl_surface.damage_buffer': return;
      case 'wl_surface.set_opaque_region': case 'wl_surface.set_input_region':
        if (a[0]) this.object(a[0], 'wl_region'); return;
      case 'wl_surface.set_buffer_scale': if (a[0] <= 0) throw Error('Invalid scale'); o.pending.scale = a[0]; return;
      case 'wl_surface.set_buffer_transform': if (a[0] > 7) throw Error('Invalid transform'); o.pending.transform = a[0]; return;
      case 'wl_surface.frame': (o.pending.callbacks ??= []).push(add(a[0], 'wl_callback')); return;
      case 'wl_surface.commit': this.commit(o); return;
      case 'xdg_wm_base.get_xdg_surface': {
        const surface = this.object(a[1], 'wl_surface');
        if (surface.xdg || surface.pixels) throw Error('Surface already has a role or buffer');
        surface.xdg = add(a[0], 'xdg_surface', { surface }); return;
      }
      case 'xdg_wm_base.pong': return;
      case 'xdg_surface.get_toplevel':
        if (o.toplevel) throw Error('Role already constructed'); o.toplevel = add(a[0], 'xdg_toplevel', { xdg: o }); return;
      case 'xdg_surface.ack_configure':
        if (a[0] !== o.configureSerial) throw Error('Unknown configure serial'); o.acked = true; return;
      case 'xdg_surface.set_window_geometry':
        if (a[2] <= 0 || a[3] <= 0) throw Error('Invalid window geometry'); o.surface.pending.geometry = a; return;
      case 'xdg_toplevel.set_title': o.title = a[0]; return;
      case 'xdg_toplevel.set_app_id': o.appId = a[0]; return;
      case 'xdg_toplevel.set_min_size': case 'xdg_toplevel.set_max_size':
        if (a.some(n => n < 0)) throw Error('Invalid size'); return;
      case 'xdg_toplevel.set_parent': if (a[0]) this.object(a[0], 'xdg_toplevel'); return;
      case 'xdg_toplevel.set_maximized': case 'xdg_toplevel.unset_maximized':
      case 'xdg_toplevel.set_fullscreen': case 'xdg_toplevel.unset_fullscreen':
      case 'xdg_toplevel.set_minimized': return; // compositor policy: client-selected size
    }
    if (name === 'destroy' || name === 'release') { this.destroy(o); return; }
    throw Error(`Not implemented: ${o.iface}.${name}`);
  }
  commit(surface) {
    const xdg = surface.xdg, p = surface.pending;
    if (xdg && !xdg.configureSerial) {
      if (!xdg.toplevel) throw Error('xdg_surface has no role');
      if (p.buffer) throw Error('Buffer before initial configure');
      this.event(xdg.toplevel, 'configure', 0, 0, Buffer.alloc(0));
      xdg.configureSerial = this.compositor.serial++; this.event(xdg, 'configure', xdg.configureSerial);
    }
    if (p.scale !== undefined) { surface.scale = p.scale; surface.dirty = true; }
    if (p.transform !== undefined) { surface.transform = p.transform; surface.dirty = true; }
    if (p.geometry) surface.geometry = p.geometry;
    if ('buffer' in p) {
      if (p.buffer && xdg && !xdg.acked) throw Error('Buffer before ack_configure');
      const b = p.buffer;
      if (b) {
        if (!this.objects.has(b.id)) throw Error('Attached buffer was destroyed');
        const bytes = Buffer.alloc(b.stride * b.height);
        let offset = 0;
        while (offset < bytes.length) {
          const n = Number(libc.pread(b.pool.fd, bytes.subarray(offset), bytes.length - offset, b.offset + offset));
          if (n <= 0) throw Error('Unreadable or truncated shm buffer'); offset += n;
        }
        surface.pixels = { bytes, width: b.width, height: b.height, stride: b.stride, format: b.format };
        this.event(b, 'release');
      } else { surface.pixels = null; if (xdg) { xdg.configureSerial = 0; xdg.acked = false; } }
      surface.dirty = true;
    }
    surface.callbacks.push(...(p.callbacks ?? [])); surface.pending = {};
  }
}

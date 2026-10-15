import { Transport, libc } from './transport.js';
import { interfaces, decode, encode } from './protocol.js';
import { WindowManager } from './window-manager.js';
import { Input } from './input.js';

const MAX_POOL = 256 * 1024 * 1024;
const globals = [['wl_compositor', 4], ['wl_shm', 1], ['xdg_wm_base', 1], ['wl_output', 2], ['wl_seat', 5]];
export class Compositor {
  constructor({ socket, width = 800, height = 600 }) {
    this.width = width; this.height = height; this.surfaces = new Set(); this.clients = new Set(); this.serial = 1; this.frames = 0;
    this.transport = new Transport(socket, connection => this.clients.add(new Client(this, connection)));
    this.wm = new WindowManager(this); this.input = new Input(this, socket);
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
    if (!this.objects.has(object.id)) return;
    const spec = interfaces.get(object.iface).events.find(e => e.name === event);
    if (Number(spec.since ?? 1) > object.version) return;
    this.connection.send(encode(object.id, object.iface, event, args), spec.args.flatMap((a,i) => a.type === 'fd' ? [args[i]] : []));
  }
  destroy(object, notify = true) {
    if (!this.objects.delete(object.id)) return;
    if (object.iface === 'wl_surface') {
      this.compositor.input.removed(object); this.compositor.wm.remove(object);
      for (const callback of [...object.callbacks, ...(object.pending.callbacks ?? [])]) this.destroy(callback, notify);
      this.compositor.surfaces.delete(object); this.compositor.onFrame?.();
    }
    if (object.iface === 'xdg_toplevel') { this.compositor.input.removed(object.xdg.surface); this.compositor.wm.remove(object.xdg.surface); object.xdg.toplevel = null; }
    if (object.iface === 'xdg_popup') {this.compositor.input.removed(object.xdg.surface);object.xdg.surface.popup=null;object.xdg.surface.pixels=null;this.compositor.input.focus(this.compositor.wm.focused?.surface??null);}
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
        if (iface === 'wl_seat') {this.event(resource, 'capabilities', 3);if(version>=2)this.event(resource,'name','buninu-seat');}
        if (iface === 'wl_output') {
          this.event(resource, 'geometry', 0, 0, 300, 200, 0, 'buninu', 'software', 0);
          this.event(resource, 'mode', 3, comp.width, comp.height, 60000);
          if (version >= 2) { this.event(resource, 'scale', 1); this.event(resource, 'done'); }
        }
        return;
      }
      case 'wl_seat.get_pointer': case 'wl_seat.get_keyboard': {
        const r=this.add(a[0],name==='get_pointer'?'wl_pointer':'wl_keyboard',o.version);comp.input.register(r);return;
      }
      case 'wl_pointer.set_cursor': comp.input.setCursor(o,a[0],a[1]?this.object(a[1],'wl_surface'):null,a[2],a[3]);return;
      case 'wl_compositor.create_surface': {
        const surface = this.add(a[0], 'wl_surface', o.version, { pending: {}, callbacks: [], pixels: null, scale: 1, transform: 0 });
        comp.surfaces.add(surface); return;
      }
      case 'wl_compositor.create_region': add(a[0], 'wl_region', {regions:[]}); return;
      case 'wl_region.add': case 'wl_region.subtract': o.regions.push({add:name==='add',rect:a});return;
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
      case 'wl_surface.set_opaque_region': if(a[0])this.object(a[0],'wl_region');return;
      case 'wl_surface.set_input_region': o.pending.inputRegion=a[0]?this.object(a[0],'wl_region').regions.slice():null;return;
      case 'wl_surface.set_buffer_scale': if (a[0] <= 0) throw Error('Invalid scale'); o.pending.scale = a[0]; return;
      case 'wl_surface.set_buffer_transform': if (a[0] > 7) throw Error('Invalid transform'); o.pending.transform = a[0]; return;
      case 'wl_surface.frame': (o.pending.callbacks ??= []).push(add(a[0], 'wl_callback')); return;
      case 'wl_surface.commit': this.commit(o); return;
      case 'xdg_wm_base.get_xdg_surface': {
        const surface = this.object(a[1], 'wl_surface');
        if (surface.role || surface.xdg || surface.pixels) throw Error('Surface already has a role or buffer');
        surface.xdg = add(a[0], 'xdg_surface', { surface }); return;
      }
      case 'xdg_wm_base.pong': return;
      case 'xdg_surface.get_toplevel':
        if (o.toplevel || o.surface.popup) throw Error('Role already constructed'); o.toplevel = add(a[0], 'xdg_toplevel', { xdg: o }); return;
      case 'xdg_surface.ack_configure':
        {const i=(o.configures??[]).indexOf(a[0]);if(i<0)throw Error('Unknown configure serial');o.configures.splice(0,i+1);o.acked=true;return;}
      case 'xdg_surface.set_window_geometry':
        if (a[2] <= 0 || a[3] <= 0) throw Error('Invalid window geometry'); o.surface.pending.geometry = a; return;
      case 'xdg_toplevel.set_title': o.title = a[0]; return;
      case 'xdg_toplevel.set_app_id': o.appId = a[0]; return;
      case 'xdg_toplevel.set_min_size': case 'xdg_toplevel.set_max_size':
        if (a.some(n => n < 0)) throw Error('Invalid size');o[name==='set_min_size'?'minSize':'maxSize']=a;return;
      case 'xdg_toplevel.set_parent': if (a[0]) this.object(a[0], 'xdg_toplevel'); return;
      case 'xdg_toplevel.set_maximized': case 'xdg_toplevel.unset_maximized':
      case 'xdg_toplevel.set_fullscreen': case 'xdg_toplevel.unset_fullscreen':
        comp.wm.fullscreen(comp.wm.add(o.xdg.surface),name.startsWith('set_'),name.includes('maximized'));return;
      case 'xdg_toplevel.move': case 'xdg_toplevel.resize':
        this.object(a[0],'wl_seat');comp.input.beginDrag(o.xdg.surface.window,a[1],name==='resize'?a[2]:0);return;
      case 'xdg_toplevel.show_window_menu': this.object(a[0],'wl_seat');return;
      case 'xdg_toplevel.set_minimized': return;
      case 'xdg_wm_base.create_positioner': add(a[0],'xdg_positioner',{position:{}});return;
      case 'xdg_positioner.set_size':
        if(a.some(v=>v<=0))throw Error('Invalid popup size');o.position.size=a;return;
      case 'xdg_positioner.set_anchor_rect':
        if(a[2]<=0||a[3]<=0)throw Error('Invalid popup anchor');o.position.anchorRect=a;return;
      case 'xdg_positioner.set_anchor': case 'xdg_positioner.set_gravity': case 'xdg_positioner.set_constraint_adjustment': case 'xdg_positioner.set_offset':
        o.position[name.slice(4)]=a;return;
      case 'xdg_surface.get_popup': {
        if(o.toplevel||o.surface.popup)throw Error('Role already constructed');
        const parent=this.object(a[1],'xdg_surface'),position=this.object(a[2],'xdg_positioner').position;
        if(!position.size||!position.anchorRect)throw Error('Incomplete positioner');
        const [width,height]=position.size,[rx,ry,rw,rh]=position.anchorRect,anchor=position.anchor?.[0]??0,gravity=position.gravity?.[0]??0;
        const left=v=>[3,5,6].includes(v),right=v=>[4,7,8].includes(v),top=v=>[1,5,7].includes(v),bottom=v=>[2,6,8].includes(v);
        let x=rx+(left(anchor)?0:right(anchor)?rw:rw/2)+(left(gravity)?-width:right(gravity)?0:-width/2)+(position.offset?.[0]??0);
        let y=ry+(top(anchor)?0:bottom(anchor)?rh:rh/2)+(top(gravity)?-height:bottom(gravity)?0:-height/2)+(position.offset?.[1]??0);
        const origin=comp.wm.origin(parent.surface),g=parent.surface.geometry??[0,0],adjust=position.constraint_adjustment?.[0]??0;
        if(adjust&1)x=Math.max(-origin.x-g[0],Math.min(x,comp.width-origin.x-g[0]-width));
        if(adjust&2)y=Math.max(-origin.y-g[1],Math.min(y,comp.height-origin.y-g[1]-height));
        o.surface.popup=add(a[0],'xdg_popup',{xdg:o,parent,box:{x:Math.round(x),y:Math.round(y),width,height}});return;
      }
      case 'xdg_popup.grab':
        this.object(a[0],'wl_seat');if(a[1]===comp.input.lastButtonSerial){comp.input.popupGrab=o;}return;
    }
    if (name === 'destroy' || name === 'release') { this.destroy(o); return; }
    throw Error(`Not implemented: ${o.iface}.${name}`);
  }
  commit(surface) {
    const xdg = surface.xdg, p = surface.pending;
    if (xdg && !xdg.configureSerial) {
      if (!xdg.toplevel&&!surface.popup) throw Error('xdg_surface has no role');
      if (p.buffer) throw Error('Buffer before initial configure');
      if(surface.popup){const b=surface.popup.box;this.event(surface.popup,'configure',b.x,b.y,b.width,b.height);xdg.configureSerial=this.compositor.serial++;xdg.configures=[xdg.configureSerial];this.event(xdg,'configure',xdg.configureSerial);}
      else this.compositor.wm.add(surface);
    }
    if (p.scale !== undefined) { surface.scale = p.scale; surface.dirty = true; }
    if (p.transform !== undefined) { surface.transform = p.transform; surface.dirty = true; }
    if (p.geometry) surface.geometry = p.geometry;
    if ('inputRegion' in p) surface.inputRegion=p.inputRegion;
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
        const first=!surface.pixels;
        surface.pixels = { bytes, width: b.width, height: b.height, stride: b.stride, format: b.format };
        this.event(b, 'release');
        if(first&&surface.window)this.compositor.wm.focus(surface.window);
        if(first&&surface.popup&&this.compositor.input.popupGrab===surface.popup)this.compositor.input.focus(surface);
      } else { this.compositor.input.removed(surface);this.compositor.wm.remove(surface);surface.pixels = null; if (xdg) { xdg.configureSerial = 0; xdg.acked = false; } }
      surface.dirty = true;
    }
    surface.callbacks.push(...(p.callbacks ?? [])); surface.pending = {};
  }
}

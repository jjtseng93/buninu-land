import { test, expect } from 'bun:test';
import { interfaces, decode, encode } from '../lib/protocol.js';
import { Compositor } from '../lib/compositor.js';
import { mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('Bun.XML preserves protocol opcode order and since versions', () => {
  expect(interfaces.get('wl_surface').requests[6].name).toBe('commit');
  expect(Number(interfaces.get('wl_surface').requests[9].since)).toBe(4);
  expect(interfaces.get('xdg_surface').requests[4].name).toBe('ack_configure');
  const message = encode(2,'wl_registry','global',[1,'wl_compositor',4]);
  expect(decode(interfaces.get('wl_registry').events[0],message,[])).toEqual([1,'wl_compositor',4]);
});

test('FD arguments wait without consuming bytes; descriptors occupy no wire bytes', () => {
  const message=Buffer.alloc(16); message.writeUInt32LE(3,8); message.writeUInt32LE(4096,12);
  const spec=interfaces.get('wl_shm').requests[0];
  expect(decode(spec,message,[])).toBeNull();
  const fds=[42,43];
  expect(decode(spec,message,fds)).toEqual([3,42,4096]); expect(fds).toEqual([43]);
  expect(() => decode(spec,message.subarray(0,12),[42])).toThrow('Truncated');
});

test('fragmented Unix stream, socket ownership, and malformed-client isolation', async () => {
  const directory=mkdtempSync(join(tmpdir(),'buninu-land-wire-')), path=join(directory,'wayland-test');
  const comp=new Compositor({socket:path}); let socket;
  try {
    expect(() => new Compositor({socket:path})).toThrow('locked');
    let received=Buffer.alloc(0);
    socket=await Bun.connect({unix:path,socket:{data(s,data){received=Buffer.concat([received,data]);},error(){},close(){}}});
    const sync=Buffer.alloc(12);sync.writeUInt32LE(1);sync.writeUInt32LE(12<<16,4);sync.writeUInt32LE(2,8);
    socket.write(sync.subarray(0,3)); await Bun.sleep(20); expect(received.length).toBe(0);
    socket.write(sync.subarray(3));
    for(let i=0;i<50 && received.length<24;i++) await Bun.sleep(10);
    expect(received.readUInt32LE(0)).toBe(2); // callback.done
    expect(received.readUInt32LE(12)).toBe(1); // display.delete_id
    socket.write(Buffer.from([1,0,0,0,0,0,7,0]));
    for(let i=0;i<50 && comp.clients.size;i++) await Bun.sleep(10);
    expect(comp.clients.size).toBe(0);
    expect(existsSync(path)).toBe(true);
  } finally {socket?.end();comp.close();}
  expect(existsSync(path)).toBe(false);
});

import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import * as resources from './win32-resources.js';
import {MappingConnection} from './win32-wire.js';
export const {libc,errno}=resources;
export const Connection=MappingConnection;
export class Transport {
 constructor(path,onClient,pollInterval=4){
  if(!Number.isInteger(pollInterval)||(pollInterval!==-1&&(pollInterval<1||pollInterval>1000)))throw Error('Invalid socket poll interval');
  this.clients=new Set();this.path=path;mkdirSync(dirname(path),{recursive:true});
  const owner=this;
  this.server=Bun.listen({unix:path,socket:{
   open(socket){const c=new MappingConnection(resources,()=>owner.clients.delete(c));socket.data=c;owner.clients.add(c);c.attach(socket);onClient(c)},
   data:(s,b)=>s.data.receive(b),drain:s=>s.data.flush(),close:s=>s.data.close(),error:(s,e)=>{s.data.error=e;s.data.close()},
  }});
 }
 poll(){for(const c of this.clients)c.poll()}
 close(){if(this.closed)return;this.closed=true;for(const c of this.clients)c.close();this.server.stop(true)}
}

import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {start} from '../compositor.js';

test('lazy DMA-BUF flag requires import, defaults off, and preserves legacy opt-in',async()=>{
 const keys=['XDG_RUNTIME_DIR','BUNINU_EXPERIMENT_DMABUF_LAZY'],old=keys.map(k=>process.env[k]);
 const dir=mkdtempSync(join(tmpdir(),'land-lazy-cli-'));
 process.env.XDG_RUNTIME_DIR=dir;delete process.env.BUNINU_EXPERIMENT_DMABUF_LAZY;
 const check=async(args,expected)=>{
  const app=await start(['--remote-debugging-port=0','--no-render-worker',...args]);
  try{expect(app.compositor.lazyDmabuf).toBe(expected);}finally{app.close();}
 };
 try{
  const error=await start(['--lazy-dmabuf']).then(()=>null,error=>error);
  expect(error?.message).toBe('--lazy-dmabuf requires --linear-dmabuf');
  expect(readdirSync(dir)).toEqual([]);
  await check([],false);await check(['--linear-dmabuf'],false);
  await check(['--linear-dmabuf','--lazy-dmabuf'],true);
  process.env.BUNINU_EXPERIMENT_DMABUF_LAZY='1';
  await check(['--linear-dmabuf'],true);await check([],false);
 }finally{keys.forEach((k,i)=>{if(old[i]===undefined)delete process.env[k];else process.env[k]=old[i];});rmSync(dir,{recursive:true,force:true});}
});

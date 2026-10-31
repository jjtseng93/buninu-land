import {test,expect} from 'bun:test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Wallpaper,DEFAULT_WALLPAPER,wallpaperArgument,decodeWallpaperPng} from '../lib/wallpaper.js';
import {rgbaBitmap} from '../lib/frame.js';
import {start} from '../compositor.js';
async function image(path,width,height,rgba){
  const bytes=new Uint8Array(width*height*4);for(let i=0;i<bytes.length;i+=4)bytes.set(rgba,i);
  await Bun.write(path,await new Bun.Image(rgbaBitmap(bytes,width,height)).png().bytes());
}
test('wallpaper arguments accept both forms and reject missing values',()=>{
  expect(wallpaperArgument([])).toBeNull();
  expect(wallpaperArgument(['--wallpaper','a','--wallpaper=b'])).toBe('b');
  expect(()=>wallpaperArgument(['--wallpaper'])).toThrow('requires a path');
  expect(()=>wallpaperArgument(['--wallpaper='])).toThrow('requires a path');
});
test('wallpaper flattens alpha, caches several sizes and falls back to the bundled image',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'land-wallpaper-')),wallpaper=new Wallpaper();
 try{
  const path=join(dir,'transparent.png');await image(path,4,4,[200,80,40,128]);
  expect(await wallpaper.set(path)).toBe(path);
  const first=await wallpaper.prepare(30,20),second=await wallpaper.prepare(40,30);
  expect(await wallpaper.prepare(30,20)).toBe(first);
  expect(await wallpaper.prepare(40,30)).toBe(second);
  expect([...first.pixels.bytes.slice(0,4)]).toEqual([37,54,112,255]);
  expect(wallpaper.current.sizes.size).toBe(2);
  const scaled=await wallpaper.prepare(30,20,.6);
  expect(scaled.pixels.width).toBe(18);expect(scaled.pixels.height).toBe(12);
  await wallpaper.set(dir);expect(wallpaper.current.path).toBe(DEFAULT_WALLPAPER);
  const builtin=await wallpaper.prepare(20,20);expect(builtin.pixels.bytes.some(v=>v!==255)).toBe(true);
  const bad=join(dir,'bad.txt');await Bun.write(bad,'not an image');await wallpaper.set(bad);
  expect(wallpaper.current.path).toBe(DEFAULT_WALLPAPER);
  expect(wallpaper.current.sizes.size).toBe(0);
  await wallpaper.set(join(dir,'missing.png'));expect(wallpaper.current.path).toBe(DEFAULT_WALLPAPER);
  expect(()=>decodeWallpaperPng(new Uint8Array(33),10,10)).toThrow();
 }finally{wallpaper.close();await rm(dir,{recursive:true,force:true});}
 expect(wallpaper.current).toBeNull();expect(wallpaper.surface).toBeNull();
});
for(const worker of [false,true])test(`wallpaper reaches real ${worker?'worker':'main'} renderer and survives resize`,async()=>{
 const dir=await mkdtemp(join(tmpdir(),'land-wallpaper-render-'));let app;
 try{
  const path=join(dir,'red.png');await image(path,4,4,[220,20,30,255]);
  app=await start(['--remote-debugging-port=0',`--socket=wallpaper-${process.pid}-${worker}`,`--wallpaper=${path}`,'--window-size=50,40',...(worker?[]:['--no-render-worker'])]);
  const capture=async()=>{const raw=JSON.parse(await app.context.screenshot({format:'bgra'}));return Bun.file(raw.path).bytes();};
  const bytes=await capture();expect([...bytes.slice(0,4)]).toEqual([30,20,220,255]);
  const first=app.wallpaper.surface;
  app.context.resize(70,50);expect((await capture()).length).toBe(70*50*4);
  app.context.resize(50,40);await capture();expect(app.wallpaper.surface).toBe(first);
  expect(app.desktop.worker).toBeUndefined(); // ordinary wallpaper never starts command JS
 }finally{app?.close();await rm(dir,{recursive:true,force:true});}
},20000);

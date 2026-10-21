import {test,expect} from 'bun:test';
import {WindowManager} from '../lib/window-manager.js';

function fixture(count=3){
 const events=[];
 const comp={width:800,height:600,serial:1,surfaces:[],input:{focus(){},pointerFocus(){}}};
 const wm=new WindowManager(comp);comp.wm=wm;
 const windows=Array.from({length:count},()=>{
  const surface={pixels:{},client:{objects:new Map(),event:(...args)=>events.push(args)},xdg:{toplevel:{}}};
  comp.surfaces.push(surface);const w=wm.add(surface);wm.focus(w);return w;
 });
 return {wm,windows,events};
}

test('Omarchy float, maximize and close reuse window actions with exact modifiers',()=>{
 const {wm,windows:[w],events}=fixture(1),tiled={...w.box};
 expect(wm.shortcut('T',4)).toBe(true);expect(w.floating).toBe(true);
 const floating={...w.box};
 wm.shortcut('f',5);expect(w.maximized).toBe(true);expect(w.fullscreen).toBe(false);
 wm.shortcut('F',5);expect(w.maximized).toBe(false);expect(w.box).toEqual(floating);
 wm.shortcut('t',4);expect(w.floating).toBe(false);expect(w.box).toEqual(tiled);
 wm.shortcut('q',4);expect(events.at(-1)[1]).toBe('close');
 for(const [key,mods] of [['t',12],['q',5],['f',6],['j',4],['s',4],['g',4],['0',4],['Tab',4],['Tab',3]])
  expect(wm.shortcut(key,mods)).toBe(false);
});

test('directional swaps retain focus and workspace movement follows the window',()=>{
 const {wm,windows:[left,right]}=fixture(2);
 const leftBox={...left.box},rightBox={...right.box};
 wm.shortcut('ArrowLeft',12);
 expect(wm.focused).toBe(right);expect(right.box).toEqual(leftBox);expect(left.box).toEqual(rightBox);
 wm.shortcut('@',12,'Digit2');expect(right.workspace).toBe(2);expect(wm.workspace).toBe(2);expect(wm.focused).toBe(right);
 wm.shortcut('1',4,'Digit1');expect(wm.focused).toBe(left);
 wm.shortcut('9',4);expect(wm.workspace).toBe(9);expect(wm.focused).toBeNull();
 expect(wm.shortcut('#',13,'Digit3')).toBe(false);
});

test('Alt Tab cycles all three windows in either direction and transfers fullscreen',()=>{
 const {wm,windows:[a,b,c]}=fixture();
 wm.shortcut('Tab',1);expect(wm.focused).toBe(a);
 wm.shortcut('Tab',1);expect(wm.focused).toBe(b);
 wm.shortcut('Tab',1);expect(wm.focused).toBe(c);
 for(const w of [b,a,c]){wm.shortcut('Tab',9);expect(wm.focused).toBe(w);}
 wm.fullscreen(c,true);wm.shortcut('Tab',1);
 expect(wm.focused).toBe(a);expect(a.fullscreen).toBe(true);expect(c.fullscreen).toBe(false);
 expect(wm.renderSurfaces()).toEqual([a.surface]);
});

test('physical resize keys handle shifted symbols and fine/coarse increments',()=>{
 const {wm,windows:[w]}=fixture(1);wm.toggleFloating();
 const box={...w.box};
 wm.shortcut('=',4,'Equal');expect(w.box.width).toBe(box.width+100);
 wm.shortcut('_',12,'Minus');expect(w.box.height).toBe(box.height-100);
 wm.shortcut('+',13,'Equal');expect(w.box.height).toBe(box.height-75);
 wm.shortcut('-',6,'Minus');expect(w.box.width).toBe(box.width-200);
 expect(wm.shortcut('=',7,'Equal')).toBe(false);
 const tiled=fixture(2);const width=tiled.windows[0].box.width;
 tiled.wm.shortcut('=',4,'Equal');expect(tiled.windows[0].box.width).toBeGreaterThan(width);
});


test('floating and moving a focused window back into an occupied tree keeps distinct leaves',()=>{
 const {wm,windows:[left,right]}=fixture(2);
 for(let i=0;i<3;i++){
  wm.shortcut('t',4);wm.shortcut('t',4);
  expect(wm.roots.get(1).children.map(n=>n.window)).toEqual([left,right]);
  wm.shortcut('2',12);wm.shortcut('1',12);
  expect(wm.roots.get(1).children.map(n=>n.window)).toEqual([left,right]);
 }
 wm.remove(right.surface);
 expect(wm.roots.get(1).window).toBe(left);
});


test('directional swaps do not turn into focus changes for floating windows',()=>{
 const {wm,windows:[left,right]}=fixture(2);
 wm.toggleFloating(right);const box={...right.box};
 wm.shortcut('ArrowLeft',12);
 expect(wm.focused).toBe(right);expect(right.box).toEqual(box);
 wm.focus(left);wm.shortcut('ArrowRight',12);expect(wm.focused).toBe(left);
});

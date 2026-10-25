import {test,expect} from 'bun:test';
import {Input} from '../lib/input.js';

function pointer(version=5) {
  const events=[];
  const client={objects:new Map(),event:(resource,name,...args)=>events.push({name,args})};
  const resource={iface:'wl_pointer',version,client};client.objects.set(1,resource);
  const surface={id:2,client};
  const comp={serial:1,clients:new Set([client]),wm:{hit:()=>({surface}),origin:()=>({x:0,y:0})}};
  return {input:new Input(comp,'/tmp/unused-scroll-test'),events};
}

test('wheel axes form a separate frame after pointer positioning',()=>{
  const {input,events}=pointer();
  input.mouse({type:'mouseWheel',x:10,y:20,deltaY:100,deltaX:-200});
  expect(events.map(e=>e.name)).toEqual(['enter','motion','frame','axis_source','axis','axis','frame']);
  expect(events.filter(e=>e.name==='axis_source').map(e=>e.args)).toEqual([[2]]);
  expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[0,10],[1,-20]]);
  events.length=0;
  input.mouse({type:'mouseWheel',x:10,y:20,deltaY:-100,deltaX:0});
  expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[0,-10]]);
});

test('fractional scroll retains continuous values and old pointers receive only axis events',()=>{
  const {input,events}=pointer();
  input.mouse({type:'mouseWheel',x:10,y:20,deltaY:2.5,deltaX:0});
  expect(events.filter(e=>e.name==='axis_source').map(e=>e.args)).toEqual([[2]]);
  expect(events.some(e=>e.name==='axis_discrete')).toBe(false);
  expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[0,0.25]]);
  const old=pointer(4);
  old.input.mouse({type:'mouseWheel',x:10,y:20,deltaY:100,deltaX:0});
  expect(old.events.map(e=>e.name)).toEqual(['enter','motion','axis']);
});

test('one-shot wheel modifiers precede axis frame and restore held keyboard state',()=>{
  const {input,events}=pointer();
  const client=[...input.comp.clients][0];
  client.objects.set(3,{iface:'wl_keyboard',version:5,client});
  input.mouse({type:'mouseWheel',x:10,y:20,deltaY:100,modifiers:8});
  const names=events.map(e=>e.name),mods=events.filter(e=>e.name==='modifiers');
  expect(mods.map(e=>e.args[1])).toEqual([1,0]);
  expect(names.indexOf('modifiers')).toBeLessThan(names.indexOf('axis'));
  const axis=names.indexOf('axis'),restore=names.lastIndexOf('modifiers');
  expect(names.slice(axis+1,restore)).toContain('frame');
  expect(input.mods).toBe(0);
  events.length=0;input.mods=4;input.physicalMods=2;
  input.mouse({type:'mouseWheel',x:10,y:20,deltaX:100,modifiers:8});
  expect(events.filter(e=>e.name==='modifiers').map(e=>e.args[1])).toEqual([5,4]);
  expect(input.mods).toBe(4);
});


test('wheel Shift Alt Ctrl combinations survive and restore for both axes',()=>{
  for(let mask=0;mask<8;mask++)for(const axis of ['deltaX','deltaY']){
    const {input,events}=pointer();
    const client=[...input.comp.clients][0];
    client.objects.set(3,{iface:'wl_keyboard',version:5,client});
    const modifiers=(mask&1?8:0)|(mask&2?1:0)|(mask&4?2:0);
    input.mouse({type:'mouseWheel',x:10,y:20,[axis]:100,modifiers});
    const expected=(mask&1?1:0)|(mask&2?8:0)|(mask&4?4:0);
    expect(events.filter(e=>e.name==='modifiers').map(e=>e.args[1])).toEqual(mask?[expected,0]:[]);
    expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[axis==='deltaX'?1:0,10]]);
  }
});

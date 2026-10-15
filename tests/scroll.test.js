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
  expect(events.filter(e=>e.name==='axis_source').map(e=>e.args)).toEqual([[0]]);
  expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[0,10],[1,-20]]);
  events.length=0;
  input.mouse({type:'mouseWheel',x:10,y:20,deltaY:-100,deltaX:0});
  expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[0,-10]]);
});

test('fractional scroll retains continuous values and old pointers receive only axis events',()=>{
  const {input,events}=pointer();
  input.mouse({type:'mouseWheel',x:10,y:20,deltaY:2.5,deltaX:0});
  expect(events.filter(e=>e.name==='axis_source').map(e=>e.args)).toEqual([[0]]);
  expect(events.some(e=>e.name==='axis_discrete')).toBe(false);
  expect(events.filter(e=>e.name==='axis').map(e=>e.args.slice(1))).toEqual([[0,0.25]]);
  const old=pointer(4);
  old.input.mouse({type:'mouseWheel',x:10,y:20,deltaY:100,deltaX:0});
  expect(old.events.map(e=>e.name)).toEqual(['enter','motion','axis']);
});

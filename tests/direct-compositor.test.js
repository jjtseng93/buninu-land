import { test, expect } from "bun:test";
import CanvasKitInit from "../vendor/canvaskit/canvaskit.js";
import { createRenderer } from "../lib/renderer.js";
import { createRenderer as createReference } from "./support/canvaskit-renderer.js";
import { createDirectComposer } from "../lib/direct-compositor.js";
import { allocateSnapshot } from "../lib/snapshot.js";
const CK = await CanvasKitInit({
  wasmBinary: await Bun.file(
    new URL("../vendor/canvaskit/canvaskit.wasm", import.meta.url),
  ).arrayBuffer(),
});
const decode = (data) => {
  const image = CK.MakeImageFromEncoded(Buffer.from(data, "base64"));
  try {
    return image.readPixels(0, 0, {
      width: image.width(),
      height: image.height(),
      colorType: CK.ColorType.RGBA_8888,
      alphaType: CK.AlphaType.Unpremul,
      colorSpace: CK.ColorSpace.SRGB,
    });
  } finally {
    image.delete();
  }
};
let seed = 1;
const random = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed >>> 24;
};
function surface(alpha, x, y) {
  const width = 19,
    height = 15,
    stride = width * 4 + 12,
    bytes = allocateSnapshot(stride * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * stride + x * 4,
        a = alpha ? random() : 255;
      for (let c = 0; c < 3; c++)
        bytes[i + c] = Math.floor((random() * a) / 255);
      bytes[i + 3] = a;
    }
  return {
    pixels: { bytes, width, height, stride, format: alpha ? 0 : 1 },
    scale: 1,
    transform: 0,
    origin: { x, y },
  };
}

test("composition and opt-in PNG match CanvasKit pixels across scenes, transforms and viewports", async () => {
  let visible = [];
  const labels = [];
  const comp = {
    width: 32,
    height: 24,
    deviceScaleFactor: 1,
    input: {},
    measure: (s) => labels.push(s),
    wm: { renderSurfaces: () => visible, origin: (s) => s.origin },
  };
  const reference = await createReference(comp, { canvasKit: CK });
  const renderer = await createRenderer(comp, { canvasKit: CK });
  try {
    for (const mode of [
      "opaque",
      "xrgb-unused-alpha",
      "alpha",
      "clip",
      "offscreen",
      "cursor",
      "pointer",
      "fractional-position",
      "integer-scale",
      "fractional-scale",
      "viewport",
      "rotate",
      "flip",
      "empty",
    ]) {
      comp.input = {};
      comp.deviceScaleFactor = 1;
      visible = [
        surface(false, 0, 0),
        surface(true, 7, 4),
        surface(mode === "alpha", -3, 10),
      ];
      // XRGB ignores its alpha bytes. CanvasKit copied them into its output;
      // the reference draws the same colours with alpha 255.
      let unusedAlpha = null;
      if (mode === "xrgb-unused-alpha") {
        unusedAlpha = { ...visible[0].pixels, bytes: Buffer.from(visible[0].pixels.bytes) };
        for (let i = 3; i < unusedAlpha.bytes.length; i += 4)
          unusedAlpha.bytes[i] = random();
      }
      const clean = visible[0]?.pixels;
      if (mode === "clip") visible[1].origin = { x: -10, y: -8 };
      if (mode === "offscreen") visible[1].origin = { x: 100, y: 100 };
      if (mode === "cursor")
        comp.input = {
          x: 30,
          y: 23,
          cursor: { surface: surface(true, 0, 0), x: 3, y: 4 },
        };
      if (mode === "pointer") comp.input = { pointer: true, x: 30, y: 22 };
      if (mode === "fractional-position") visible[1].origin.x = 2.5;
      if (mode === "integer-scale") visible[1].scale = 2;
      if (mode === "fractional-scale") {
        comp.deviceScaleFactor = 0.6;
        visible[1].fractionalScale = {};
      }
      if (mode === "viewport") {
        visible[1].viewportSource = [2, 3, 8, 6];
        visible[1].viewportDestination = [12, 10];
      }
      if (mode === "rotate") visible[1].transform = 1;
      if (mode === "flip") visible[1].transform = 4;
      if (mode === "empty") visible = [];
      for (const options of [
        {},
        { maxWidth: 16 },
        { viewport: { width: 20, height: 16 } },
      ]) {
        if (unusedAlpha) visible[0].pixels = clean;
        comp.fastPng = false;
        const expected = decode(await reference.screenshot(options));
        if (unusedAlpha) visible[0].pixels = unusedAlpha;
        for (const fast of [false, true]) {
          comp.fastPng = fast;
          labels.length = 0;
          const encoded = await renderer.screenshot(options),
            actual = decode(encoded);
          if (mode === "fractional-scale") {
            // Filtered sampling rounds in floats; Skia may differ by one unit.
            expect(actual.length).toBe(expected.length);
            let max = 0;
            for (let i = 0; i < actual.length; i++) max = Math.max(max, Math.abs(actual[i] - expected[i]));
            expect(max, `${mode} fast=${fast} options=${JSON.stringify(options)}`).toBeLessThanOrEqual(1);
          } else expect(
            actual,
            `${mode} fast=${fast} options=${JSON.stringify(options)}`,
          ).toEqual(expected);
          expect(decode(await renderer.screenshot(options))).toEqual(actual);
          // Every scene is composed in TypeScript; CanvasKit is only the reference.
          expect(labels.some((s) => s.endsWith(":direct-compose"))).toBe(true);
          if (fast)
            expect(Buffer.from(encoded, "base64")[25]).toBe(2); // lossless RGB PNG
        }
      }
    }
    await expect(renderer.screenshot({ maxWidth: 0 })).rejects.toThrow(
      "Invalid capture limit",
    );
    await expect(
      renderer.screenshot({ viewport: { width: 0, height: 10 } }),
    ).rejects.toThrow("Invalid capture size");
  } finally {
    renderer.close();
    reference.close();
  }
  await expect(renderer.screenshot()).rejects.toThrow("closed");
}, 30000);

test("direct scene cache follows replacement snapshots, stacking, cursor and geometry", () => {
  const a = surface(false, 0, 0),
    b = surface(true, 1, 1);
  let visible = [a, b];
  const comp = {
      input: {},
      wm: { renderSurfaces: () => visible, origin: (s) => s.origin },
    },
    renderer = createDirectComposer(comp);
  const first = renderer.compose(32, 24);
  expect(renderer.compose(32, 24)).toBe(first);
  a.pixels = surface(false, 0, 0).pixels;
  const replacement = renderer.compose(32, 24);
  expect(replacement).not.toEqual(first);
  visible = [b, a];
  expect(renderer.compose(32, 24)).not.toEqual(replacement);
  const before = renderer.compose(32, 24);
  a.origin.x = 2;
  expect(renderer.compose(32, 24)).not.toEqual(before);
  comp.input = { pointer: true, x: 30, y: 23 };
  expect(renderer.compose(32, 24)[23 * 32 + 30]).toBe(0xffffffff);
  expect(renderer.compose(16, 12).length).toBe(192);
  renderer.close();
});

test('physical pixel mapping matches CanvasKit at fractional and integer output scales', async()=>{
 let visible=[];const labels=[];
 const comp={width:40,height:32,deviceScaleFactor:1,fastPng:true,input:{},measure:s=>labels.push(s),wm:{renderSurfaces:()=>visible,origin:s=>s.origin}};
 const reference=await createReference(comp,{canvasKit:CK});
 const renderer=await createRenderer(comp,{canvasKit:CK});
 try {
  for(const factor of [1,1.25,1.5,1.625,1.75,2])for(const mode of ['upscale','alpha','clip','physical','fractional-snap']){
   comp.deviceScaleFactor=factor;
   const s=surface(mode==='alpha',0,0);visible=[s];
   s.viewportDestination=[24,24];
   if(mode==='clip')s.origin={x:-8,y:-8};
   if(mode==='physical'){s.scale=2;s.viewportDestination=[19/factor,15/factor];}
   if(mode==='fractional-snap'){s.fractionalScale={};s.viewportDestination=[Math.round(19/factor),Math.round(15/factor)];s.origin={x:1,y:3};}
   const expected=decode(await reference.screenshot());labels.length=0;
   const actual=decode(await renderer.screenshot());
   expect(actual,`${factor} ${mode}`).toEqual(expected);
   if(mode!=='fractional-snap' && s.viewportDestination.every(v=>Number.isSafeInteger(v*factor)))expect(labels.some(s=>s.endsWith(':direct-compose')),`${factor} ${mode}`).toBe(true);
  }
 }finally{reference.close();renderer.close();}
},30000);

test('repeated opaque rows and translucent overlays preserve destination pixels across commits', async()=>{
 const base=surface(false,-4,-4),top=surface(false,0,0);
 base.viewportDestination=[32,24];top.viewportDestination=[24,24];top.pixels.format=0;
 const comp={width:32,height:24,deviceScaleFactor:1.5,fastPng:true,input:{},wm:{renderSurfaces:()=>[base,top],origin:s=>s.origin}};
 const reference=await createReference(comp,{canvasKit:CK});
 const renderer=await createRenderer(comp,{canvasKit:CK});
 try{
  for(const alpha of [false,true,false]){
   top.pixels=surface(alpha,0,0).pixels;top.pixels.format=0;
   expect(decode(await renderer.screenshot())).toEqual(decode(await reference.screenshot()));
   top.origin={x:-4,y:4};
   expect(decode(await renderer.screenshot())).toEqual(decode(await reference.screenshot()));
  }
 }finally{reference.close();renderer.close();}
});

test('previews sample the directly composed frame like CanvasKit', async()=>{
 // Integer physical bounds at every factor below, so full frames compose directly.
 const base=surface(false,0,0),top=surface(true,8,8);base.viewportDestination=[40,32];top.viewportDestination=[24,16];
 const labels=[];
 const comp={width:40,height:32,deviceScaleFactor:1,fastPng:true,input:{},measure:s=>labels.push(s),wm:{renderSurfaces:()=>[base,top],origin:s=>s.origin}};
 const reference=await createReference(comp,{canvasKit:CK});
 const renderer=await createRenderer(comp,{canvasKit:CK});
 try{
  for(const factor of [1,1.125,1.5,2])for(const maxWidth of [5,10,13,16,20,27,39]){
   comp.deviceScaleFactor=factor;
   // The CanvasKit reference draws a preview from its cached full-size image.
   await reference.screenshot();labels.length=0;
   const actual=decode(await renderer.screenshot({maxWidth}));
   expect(actual,`${factor} ${maxWidth}`).toEqual(decode(await reference.screenshot({maxWidth})));
   expect(labels.some(s=>s.endsWith(':direct-compose')),`${factor} ${maxWidth}`).toBe(true);
   top.pixels=surface(true,0,0).pixels;
  }
 }finally{reference.close();renderer.close();}
},30000);

test('fractional positions, scales, clips and pointers compose directly with CanvasKit sampling', async()=>{
 let visible=[];const labels=[];
 const comp={width:48,height:40,deviceScaleFactor:1,fastPng:true,input:{},measure:s=>labels.push(s),wm:{renderSurfaces:()=>visible,origin:s=>s.origin}};
 const reference=await createReference(comp,{canvasKit:CK});
 const renderer=await createRenderer(comp,{canvasKit:CK});
 const pick=list=>list[random()%list.length];
 try{
  for(let trial=0;trial<80;trial++){
   comp.deviceScaleFactor=pick([1,1.1,1.125,1.25,4/3,1.5,1.75,2]);
   visible=[0,1,2].map(i=>{
    const s=surface(i===2,pick([0,0.25,0.5,1/3,0.75])+random()%20-4,pick([0,0.5,0.1,2/3])+random()%16-4);
    if(i===1)s.viewportDestination=[19+random()%9+pick([0,0.5,0.25]),15+random()%7];
    if(i===2&&random()%2){s.scale=2;}
    return s;
   });
   if(trial%3===0)comp.input={pointer:true,x:random()%48+pick([0,0.5,0.3]),y:random()%40+pick([0,0.25])};else comp.input={};
   const clip=trial%2?{x:pick([0,1,2.5,0.3,-1.25]),y:pick([0,3,1.5,0.7]),width:40,height:30,scale:1}:undefined;
   labels.length=0;
   expect(decode(await renderer.screenshot({clip})),`trial ${trial}`).toEqual(decode(await reference.screenshot({clip})));
   expect(labels.some(s=>s.endsWith(':direct-compose')),`trial ${trial}`).toBe(true);
  }
 }finally{reference.close();renderer.close();}
},60000);

test('experimental RGBA capture matches PNG pixels without changing standard screenshots',async()=>{
 const s=surface(false,-2,0),comp={width:32,height:24,deviceScaleFactor:1.5,fastPng:true,input:{},wm:{renderSurfaces:()=>[s],origin:s=>s.origin}};
 s.viewportDestination=[24,24];
 const renderer=await createRenderer(comp,{canvasKit:CK});
 try{
  for(const transform of [0,1]){
   s.transform=transform;
   const before=await renderer.screenshot({format:'png'});
   const descriptor=JSON.parse(await renderer.screenshot({format:'rgba'}));
   const raw=Buffer.from(await Bun.file(descriptor.path).arrayBuffer());
   expect(raw.length).toBe(48*36*4);
   expect(raw).toEqual(Buffer.from(decode(before)));
   expect(await renderer.screenshot({format:'png'})).toBe(before);
  }
 }finally{renderer.close();}
});

test('fractional enlargement and scaled pointer match CanvasKit without fallback',async()=>{
 const s=surface(false,0,0),labels=[];
 const comp={width:32,height:24,deviceScaleFactor:1,fastPng:true,input:{},measure:n=>labels.push(n),wm:{renderSurfaces:()=>[s],origin:s=>s.origin}};
 const reference=await createReference(comp,{canvasKit:CK});
 const renderer=await createRenderer(comp,{canvasKit:CK});
 try{
  for(const alpha of [false,true])for(const origin of [0,8,-8])for(const factor of [1.25,1.5,1.625,1.75,2.25]){
   s.pixels=surface(alpha,0,0).pixels;s.origin={x:origin,y:origin};
   comp.deviceScaleFactor=factor;
   for(const position of [null,[0,0],[2.5,3.5],[-2,-3],[31,23],[100,100]]){
    comp.input=position?{pointer:true,x:position[0],y:position[1]}:{};
    const expected=decode(await reference.screenshot());
    labels.length=0;
    const actual=decode(await renderer.screenshot());
    const diffs=[];for(let i=0;i<actual.length;i++)if(actual[i]!==expected[i])diffs.push([i,actual[i],expected[i]]);
    expect(diffs.slice(0,12),JSON.stringify({factor,position,count:diffs.length})).toEqual([]);
    expect(labels.some(n=>n.endsWith(':direct-compose'))).toBe(true);
   }
  }
 }finally{reference.close();renderer.close();}
});

test('scaled and fractional cursor overlays keep desktop on direct path', async () => {
  const labels=[];
  const bg=surface(false,0,0);
  bg.viewportDestination=[80,60];
  for(let i=0;i<bg.pixels.bytes.length;i+=4)bg.pixels.bytes.set([30,60,90,255],i);
  const cursor=surface(true,0,0);cursor.scale=2;
  const comp={fastPng:true,width:80,height:60,deviceScaleFactor:1.75,input:{x:21,y:19,cursor:{surface:cursor,x:3,y:4}},
    wm:{renderSurfaces:()=>[bg],origin:s=>s.origin},measure:s=>labels.push(s)};
  const actual=await createRenderer(comp,{canvasKit:CK});
  const reference=await createReference(comp,{canvasKit:CK});
  try {
    for(const [x,y] of [[21,19],[22,20],[22.25,20.5],[-1,-2],[79,59],[100,100]]) {
      comp.input.x=x;comp.input.y=y;
      const expected=decode(await reference.screenshot());labels.length=0;
      const got=decode(await actual.screenshot());
      expect(labels.some(s=>s.endsWith(':direct-compose'))).toBe(true);
      // Two premultiplied compositing passes may differ by one rounding unit.
      let max=0;for(let i=0;i<got.length;i++)max=Math.max(max,Math.abs(got[i]-expected[i]));
      expect(max).toBeLessThanOrEqual(1);
    }
  } finally {actual.close();reference.close();}
});

test('opaque occlusion preserves uncovered rows and translucent layers', async () => {
  const bottom=surface(true,0,0),top=surface(false,-2,5),overlay=surface(true,3,8);
  top.viewportDestination=[24,6];
  // Upscale instead of downscale to exercise direct composition.
  top.pixels.height=3;
  let layers=[bottom,top,overlay];
  const comp={width:24,height:24,fastPng:true,input:{},
    wm:{renderSurfaces:()=>layers,origin:s=>s.origin}};
  const renderer=await createRenderer(comp,{canvasKit:CK}),reference=await createReference(comp,{canvasKit:CK});
  try {
    for(const mode of ['covered','moved','partial','transparent','removed']) {
      if(mode==='moved')top.origin.y=9;
      if(mode==='partial')top.origin.x=2;
      if(mode==='transparent') {top.pixels={...top.pixels,format:0,bytes:top.pixels.bytes.slice()};top.pixels.bytes[3]=0;top.pixels.bytes.fill(0,0,3);}
      if(mode==='removed')layers=[bottom,overlay];
      expect(decode(await renderer.screenshot())).toEqual(decode(await reference.screenshot()));
    }
  } finally {renderer.close();reference.close();}
});

test('full-output copy blends moving cursors without mutating client pixels', async () => {
  const bg=surface(false,0,0);
  const packed=new Uint8Array(bg.pixels.width*bg.pixels.height*4);
  for(let y=0;y<bg.pixels.height;y++)packed.set(bg.pixels.bytes.subarray(y*bg.pixels.stride,y*bg.pixels.stride+bg.pixels.width*4),y*bg.pixels.width*4);
  bg.pixels={...bg.pixels,stride:bg.pixels.width*4,bytes:packed};
  const saved=packed.slice(),cursor=surface(true,0,0);cursor.scale=2;
  const comp={width:bg.pixels.width,height:bg.pixels.height-1,fastPng:true,input:{},wm:{renderSurfaces:()=>[bg],origin:s=>s.origin}};
  const renderer=await createRenderer(comp,{canvasKit:CK}),reference=await createReference(comp,{canvasKit:CK});
  try {
    for(const position of [[2,3],[8.25,7],[-2,0],[18,14],null]) {
      comp.input=position?{x:position[0],y:position[1],cursor:{surface:cursor,x:1,y:1}}:{};
      const got=decode(await renderer.screenshot()),expected=decode(await reference.screenshot());
      let max=0;for(let i=0;i<got.length;i++)max=Math.max(max,Math.abs(got[i]-expected[i]));
      expect(max).toBeLessThanOrEqual(1);
      expect(packed).toEqual(saved);
    }
  } finally {renderer.close();reference.close();}
});

test('Chromium cropped fractional viewport matches the legacy renderer without fallback', async () => {
  const width=791,height=1482,bytes=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;bytes[i]=x%256;bytes[i+1]=y%256;bytes[i+2]=(x^y)%256;bytes[i+3]=255;
  }
  const s={pixels:{bytes,width,height,stride:width*4,format:0},scale:1,transform:0,
    fractionalScale:{},viewportSource:[0,0,790,1481],viewportDestination:[724,1357]};
  const labels=[],comp={width:720,height:1353,deviceScaleFactor:1.0947802197802199,fastPng:true,input:{},
    wm:{renderSurfaces:()=>[s],origin:()=>({x:-2,y:-2})},measure:key=>labels.push(key)};
  const actual=await createRenderer(comp),reference=await createReference(comp,{canvasKit:CK});
  try {
    for(const clip of [undefined,{x:0,y:0,width:180,height:338,scale:1}]){
      const expected=decode(await reference.screenshot({clip}));labels.length=0;
      const result=decode(await actual.screenshot({clip}));
      expect(Buffer.from(result).equals(Buffer.from(expected))).toBe(true);
      expect(labels.some(key=>key.endsWith(':direct-compose'))).toBe(true);
      expect(labels.some(key=>key.endsWith(':compose'))).toBe(false);
    }
  }finally{actual.close();reference.close();}
});


test('opacity handling accepts missing final-row padding', () => {
  for (const alpha of [255, 128]) {
    const bytes = new Uint8Array(28); // two 3-pixel rows, stride 16, no last padding
    for (let y = 0; y < 2; y++) for (let x = 0; x < 3; x++) {
      bytes[y * 16 + x * 4] = 32;
      bytes[y * 16 + x * 4 + 3] = alpha;
    }
    const surface = {scale: 1, transform: 0, pixels: {bytes, width: 3, height: 2, stride: 16, format: 0}};
    const comp = {input: {}, wm: {renderSurfaces: () => [surface], origin: () => ({x: 0, y: 0})}};
    const renderer = createDirectComposer(comp);
    try {
      const result = renderer.compose(3, 2).slice();
      const padded = new Uint8Array(32); padded.set(bytes);
      surface.pixels = {...surface.pixels, bytes: padded};
      expect(renderer.compose(3, 2)).toEqual(result);
    } finally { renderer.close(); }
  }
});

test('geometry and cursor caches preserve pixels across backgrounds, transforms and capture changes', () => {
  const bg=surface(false,0,0), cursor=surface(true,0,0);
  const comp={input:{x:5.3,y:4.7,cursor:{surface:cursor,x:1,y:2}},wm:{renderSurfaces:()=>[bg],origin:s=>s.origin}};
  const cached=createDirectComposer(comp);
  try {
    for(const smooth of [false,true]) for(const transform of [0,1,4,7]) for(const factor of [0.75,1,1.75]) {
      cursor.transform=transform; cursor.scale=2;
      for(let frame=0;frame<4;frame++) {
        // Same cursor over a fresh desktop must reuse sampling but blend anew.
        bg.pixels={...bg.pixels,bytes:bg.pixels.bytes.slice()};
        bg.pixels.bytes[0]=(frame*43)%256;
        if(frame===2){comp.input.x+=0.4; cursor.pixels={...cursor.pixels,bytes:cursor.pixels.bytes.slice()};cursor.pixels.bytes[3]=128;}
        const width=frame===3?29:32,height=24,clipX=frame===3?2:0;
        // Ordinary top layer bypasses the cursor cache and its raster path.
        const plain={input:{},wm:{renderSurfaces:()=>[bg,cursor],origin:s=>s===cursor
          ? {x:comp.input.x-comp.input.cursor.x,y:comp.input.y-comp.input.cursor.y}:s.origin}};
        const fresh=createDirectComposer(plain);
        try {expect(cached.compose(width,height,factor,clipX,0,smooth)).toEqual(fresh.compose(width,height,factor,clipX,0,smooth));}
        finally{fresh.close();}
      }
    }
    comp.input.cursor=null;
    const fresh=createDirectComposer(comp);
    try{expect(cached.compose(32,24)).toEqual(fresh.compose(32,24));}finally{fresh.close();}
  }finally{cached.close();}
});

test('retained legacy backend runs independently and capture limits preserve validation', async () => {
  const {createLegacyRenderer}=await import('../lib/renderer.js');
  const bg=surface(false,0,0), comp={width:32,height:24,fastPng:true,input:{},wm:{renderSurfaces:()=>[bg],origin:s=>s.origin}};
  const legacy=await createLegacyRenderer(comp,{canvasKit:CK}), current=await createRenderer(comp);
  try {
    expect(decode(await current.screenshot())).toEqual(decode(await legacy.screenshot()));
    for(const maxWidth of [null,'12',NaN,-1,0]) await expect(current.screenshot({maxWidth})).rejects.toThrow('Invalid capture limit');
    for(const maxHeight of [null,'12',NaN,-1,0]) await expect(current.screenshot({maxHeight})).rejects.toThrow('Invalid capture limit');
  }finally{legacy.close();current.close();}
});

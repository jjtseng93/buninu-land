import { test, expect } from "bun:test";
import CanvasKitInit from "../vendor/canvaskit/canvaskit.js";
import { createRenderer } from "../lib/renderer.js";
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

test("automatic composition and opt-in PNG match CanvasKit pixels across scenes and fallback geometry", async () => {
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
  const reference = await createRenderer(comp, {
    canvasKit: CK,
    directComposition: false,
  });
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
      if (mode === "xrgb-unused-alpha")
        for (let i = 3; i < visible[0].pixels.bytes.length; i += 4)
          visible[0].pixels.bytes[i] = random();
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
        comp.fastPng = false;
        const expected = decode(await reference.screenshot(options));
        for (const fast of [false, true]) {
          comp.fastPng = fast;
          labels.length = 0;
          const encoded = await renderer.screenshot(options),
            actual = decode(encoded);
          expect(
            actual,
            `${mode} fast=${fast} options=${JSON.stringify(options)}`,
          ).toEqual(expected);
          expect(decode(await renderer.screenshot(options))).toEqual(expected);
          if (mode === "opaque" && !Object.keys(options).length)
            expect(labels.some((s) => s.endsWith(":direct-compose"))).toBe(
              true,
            );
          if (
            [
              "rotate",
              "flip",
              "viewport",
              "fractional-position",
              "integer-scale",
              "fractional-scale",
            ].includes(mode)
          )
            expect(labels.some((s) => s.endsWith(":direct-compose"))).toBe(
              false,
            );
          if (fast && mode !== "xrgb-unused-alpha")
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
 const reference=await createRenderer(comp,{canvasKit:CK,directComposition:false});
 const renderer=await createRenderer(comp,{canvasKit:CK});
 try {
  for(const factor of [1,1.25,1.5,1.625,2])for(const mode of ['upscale','alpha','clip','physical','fractional-snap']){
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

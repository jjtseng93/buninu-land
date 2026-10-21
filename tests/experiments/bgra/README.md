# Negotiated BGRA file experiment

> Historical experiment archive. The production implementation now lives in `lib/raw-frames.js`, Casty’s capture policy, and native bunterm. Measurements below describe the experimental versions. Patch generators require the original experimental inputs; do not apply them to current production sources.


Experimental copies only; this does not enable a new default or modify the
installed Casty, bunterm, or jsgotty. The native harness temporarily patches
Land's renderer and restores it after measurement. No CDP server change.

## Handshake

Private Kitty format `f=1111970369` (`0x42475241`, ASCII BGRA), **not an upstream
allocated format**. Query with `a=q,t=f,s=1,v=1,q=0,i=<random id>` and a four-byte
probe file. Only exact, matching `OK Buninu1 bgra` or `OK Buninu1 rgba` replies enable the corresponding raw format. `OK Buninu1 png` selects PNG.
Plain `OK`, errors, a different id, timeout, and late replies do not enable it.
The private versioned reply intentionally differs from standard Kitty OK:
existing jsgotty and Konsole can acknowledge unknown formats without validating
support. Querying does not place an image.

The experimental Casty requires working file transport and the positive query
before probing `Page.captureScreenshot({format:'bgra', ...})` or
`format:'rgba'`, according to the returned preference. The response must be a
valid raw descriptor with correct dimensions, format, byte count, and a readable
regular file of exactly that size. Merely succeeding is insufficient. The first
valid frame is displayed rather than discarded. Failure restores the original
configured format policy, not hardcoded PNG. BGRA's `data` is a JSON file descriptor as in the raw-file experiment,
not standard CDP image base64. Casty forwards the file using the private `f` and
Kitty `t=t`. It never reinterprets standard `f=32` or guesses from `.bgra`.

The bunterm-only parser wrapper validates dimensions and byte count and returns
the versioned preference computed from `screen.display`, populated by fbdev's
`FBIOGET_VSCREENINFO`. On little-endian hosts, 32-bit red@16/green@8/blue@0
prefers BGRA; red@0/green@8/blue@16 prefers RGBA. Channels must be 8-bit and
not msb-right; alpha may be absent or 8-bit at24. RGB565, 24-bit, unknown
layouts, unsupported alpha, and other byte orders conservatively select PNG.
This is a transfer preference, not permission for unconditional framebuffer copy.
The check runs per query, not per frame. RGBA file placements use standard
Kitty f=32; BGRA uses the private format. Both renderer paths are pixel-tested.

Native read-only check: 32bpp, red@16/8, green@8/8, blue@0/8, no alpha bits
(BGRX) produces `OK Buninu1 bgra`. Full suite after preference support:
69 pass, 3 skip. Runtime renderer restored after setup validation. Its image decoder uses CanvasKit BGRA_8888. Existing browser
jsgotty is untouched. The direct Land path writes its BGRA buffer without a
channel conversion. The CanvasKit fallback reads BGRA using an explicit WASM
destination allocation (the wrapper's no-destination BGRA read returns null).
Native framebuffer rendering still uses the existing CanvasKit/readPixels path.

## Validation

`bun test tests/experiments/bgra/protocol.test.js` checks fragmented replies,
false positives, wrong ids, late replies, timeout, parser opt-in and malformed
data. Colored red/blue pixels round-trip through both Land render paths and the
BGRA bunterm decoder, matching PNG. Full Land suite: 68 pass, 3 skip.

Real Konsole 25.04.2, launched with Qt's offscreen backend:

- File query: `ENOTSUPPORTED:`.
- Inline query for the same unknown format: ordinary `OK` (insufficient).
- Result: BGRA disabled, zero BGRA placement commands, valid PNG fallback sent.
- See `konsole-result.json` and `konsole.log`. The TGA warning comes from testing
  the unknown inline format; the query does not display it. This verifies the
  real parser/fallback, not an on-screen human visual inspection.

Reproduce with `QT_QPA_PLATFORM=offscreen konsole --separate -e bun
/absolute/path/to/konsole-probe.js /tmp/konsole-bgra-result.json`.

The saved Konsole/native measurements predate the spelling change from
`OK;BUNINU_BGRA_V1` to `OK Buninu1 bgra`; recorded evidence is kept unchanged.
The current handshake requires the new spelling exactly.

## Native performance

Same i5-5200U / Intel HD5500, 1920×1035 pixels, logical1280×690 at1.5x,
font20, tty6 and glmark2 shading=phong as `../raw-file`. Five-second warmup,
twenty-second count of distinct images after framebuffer flush:

| Path | Displayed FPS |
| --- | ---: |
| PNG control | 10.30 |
| RGBA file | 11.68 |
| Negotiated BGRA file | 13.20 |

The same experimental Casty against the unmodified native bunterm received only
ordinary OK, correctly selected PNG, and displayed 212 frames /20.0002 seconds
(10.60 FPS). Its Land timings contain only PNG captures, no BGRA requests.
Full positive and negative measurements are preserved in `results.json`.

BGRA: 264 frames /20.0019 seconds; median75.34 ms, p9588.54 ms.
Land full capture33.16 ms (compose20.75, file write12.39); no JS channel swap.
Casty capture58.40 ms (includes Land), forwarding0.129 ms.
Bunterm MakeImage5.93 ms, native read6.85 ms, full render37.25 ms.
Stages are nested and overlap; do not sum them into end-to-end latency.

`setup-native.js` depends on the previous `/tmp` diagnostic harnesses and native
mount layout; it is a reproducibility aid for that test machine, not an installer.
The same raw-file lifetime limitation remains: a terminated worker may leave its
last undelivered frame; the test runner cleans these owned temporary directories.
Production integration still needs robust lifetime/capability handling and a
documented private extension. Nothing has been committed.

## Native browser format probe

`bun tests/experiments/bgra/cdp-format-probe.js` launches isolated headless
processes with temporary profiles and closes only its own processes. Results
are written under `/tmp/cdp-format-probe`; recorded responses are preserved in
`cdp-format-results.json`.

Chromium headless shell155.0.8059.79: PNG succeeds; bgra and rgba both return
CDP -32602 / Invalid image format. A subsequent PNG succeeds with a valid PNG
signature. Firefox158.0: /json/version and /json/list return404; /session is
WebDriver BiDi. Page.captureScreenshot returns unknown command for all three
formats, including PNG. A BiDi session itself succeeds. Further BiDi screenshot
control was blocked by proot content-process crashes (Shared memory
PlatformHandle is not safe to map / DiscardedBrowsingContextError), so these
results do NOT establish Firefox BiDi raw-format behavior. Plain CDP cannot
fall back to PNG on that Firefox endpoint; it needs a BiDi adapter.

## Final capture selection policy

Raw takes priority over every configured format, including explicit PNG/JPEG/WebP.
Only after file transport and terminal preference succeed does Casty probe CDP.
Rejection, timeout, ordinary encoded image data, invalid metadata, or unavailable
file causes fallback. With auto, file transport uses JPEG plus PNG refinement
after activity settles; inline uses PNG. Explicit formats remain the fallback.
Inline never probes raw. No additional CDP method or server hook is added.

If an active raw capture later fails, the screencast switches to the saved
fallback, restores JPEG refinement when applicable, and does not retry raw on
resize. Capability probing is once per connection. File validation performs
metadata checks without decoding or copying pixel data.

Native end-to-end run with both negotiations: 263frames/20.0107s =13.14FPS.
HeadlessChrome155 rejects raw and then successfully captures JPEG for auto/file,
and PNG/JPEG/WebP for explicit settings; see cdp-negotiation-results.json.
Full suite:72 pass,3 skip; includes live raw failure followed by JPEG capture
and PNG refinement. Still experimental copies; production defaults unchanged.

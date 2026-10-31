# Wallpaper preparation experiment

Run from the project root:

```sh
bun bench/wallpaper.js wallpaper.jpg 9
BENCH_MODES=bunFast,bunLinear,cvk BENCH_OUTPUT=/tmp/wallpaper-fast.json bun bench/wallpaper.js wallpaper.jpg 15
```

No dependencies are installed. The experiment uses the supplied 1080x1080 JPEG,
Bun 1.4.4 on Linux arm64, and the vendored software CanvasKit build. Results are
`wallpaper-results.json` (9 samples after the first per-mode invocation) and
`wallpaper-fast-results.json` (15 samples). Modes alternate order each round.
This is a local phone benchmark, not a portable performance guarantee.

All paths preserve aspect ratio and center-crop to the requested output, flatten
transparency over #181b22, and return owned BGRA pixels. CanvasKit retains its
decoded source and uses linear filtering. Bun decodes the source each time;
`bunDefault` uses Lanczos3 and PNG compression level 6, `bunFast` uses Lanczos3
and compression level 0, and `bunLinear` uses bilinear and compression level 0.
Different sampling implementations and crop rounding need not be pixel-identical.
The JS PNG decoder is checked byte-for-byte against CanvasKit decoding the same
small PNG. It supports only the non-interlaced RGBA8 output produced here, and is
an experiment, not an untrusted-input production decoder.

The fast PNG path copies unfiltered scanlines directly. Its IDAT zlib wrapper is
removed before Bun.inflateSync (which accepts raw DEFLATE). No PNG recompression,
image disk write, base64 encoding, or screenshot encoding is included afterward.
Per-size cache hits are not measured: the experiment intentionally rebuilds each
size to measure cache-miss cost. Initialization and initial source decode are
reported separately for CanvasKit; subsequent draws may still materialize lazy
image state.

Second-run medians (milliseconds):

| Output | Bun Lanczos3 + JS | Bun bilinear + JS | CanvasKit linear |
| --- | ---: | ---: | ---: |
| 800x600 | 40.4 | 41.0 | 38.7 |
| 1280x720 | 64.0 | 57.0 | 41.0 |
| 1920x1080 | 85.7 | 81.4 | 89.0 |
| 1080x1920 | 97.4 | 83.3 | 88.5 |

The first run had lower Bun medians in several cases, and one CanvasKit sample
stalled for 8.6 seconds at 1920x1080. The follow-up did not reproduce that stall;
its cause was not profiled. Preserve both reports rather than discard it.
Scheduling, GC, and thermal effects were not isolated. This evidence supports
competitive uncached preparation cost for the fast Bun route, not a universal
speed advantage. PNG compression level 6 was far slower (153–676 ms medians).

A 1920x1080 cover operation on the square input produces a 1920x1920 intermediate
PNG in Bun (about 14.8 MB with compression disabled), whereas CanvasKit draws
straight into the requested viewport. Budget transient memory and retain prepared
sizes to avoid repeating work. No production wallpaper/dialog code is added by
this benchmark.

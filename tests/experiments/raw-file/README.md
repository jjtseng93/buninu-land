# Raw RGBA file handoff experiment

> Historical experiment archive. The production implementation now lives in `lib/raw-frames.js`, Casty’s capture policy, and native bunterm. Measurements below describe the experimental versions. Patch generators require the original experimental inputs; do not apply them to current production sources.


This is an isolated performance experiment, not a supported CDP extension.
`patch.js` generates temporary renderer and Casty copies from the earlier
`format: 'rgba'` experiment. Standard PNG captures are unchanged.

The experimental renderer writes each frame to a unique mode-0600 file in a
private `tty-graphics-protocol-land-*` temporary directory. Instead of image
base64, CDP's `data` contains a JSON string with path, dimensions, pixel format,
and byte count. Casty forwards only the path and geometry using Kitty
`f=32,t=t`. Bunterm's existing parser reads and unlinks the temporary file;
the renderer removes its directory on close. Sixteen outstanding files stop
capture rather than overwrite unread frames or consume unbounded memory.

This requires a shared filesystem namespace and a cooperating local terminal.
It is not suitable for a remote CDP client. No CDP server patch, new dependency,
or bunterm runtime change is used. Casty's existing preview suppression from
the raw experiment remains in place. Production integration would need explicit
capability negotiation, failure handling, and lifecycle handling for frames
discarded before delivery. The returned JSON descriptor is not standard CDP.

## Measurement

Native i5-5200U / Intel HD 5500, framebuffer 1920×1080, image 1920×1035,
Land logical size 1280×690 at scale 1.5. Bunterm tty6, font20, cell12×23.
Intel glmark2-wayland shading=phong, 1280×690. Warm up five seconds, then count
new image identities after framebuffer flush for twenty seconds. This measures
displayed frames, not glmark2's client render rate. Small PNG change-detection
captures remain enabled. `/tmp` is tmpfs.

Casty: `CASTY_CAPTURE_MIN_INTERVAL=16`, file transport, `--no-shortcuts`.
Land: `--linear-dmabuf --drm-device=/dev/dri/renderD129 --lazy-dmabuf
--poll-interval=1 --fast-png`.

First raw-file run: 234 frames / 20.0282 seconds = 11.68 FPS, median frame
interval 83.59 ms, p95 103.94 ms. Earlier raw-base64 run was 5.20 FPS and PNG
was 10.30 FPS. Raw pixels occupy 7,948,800 bytes per frame; no pixel base64
passes through CDP or Casty in the file experiment.

An immediately repeated PNG control measured 206 frames / 20.0002 seconds =
10.30 FPS. File handoff therefore improved displayed FPS by 13.4% in this
comparison. Full statistics are in `results.json` (`current` is PNG).

| Stage, mean milliseconds | PNG control | Raw file |
| --- | ---: | ---: |
| Land full capture, including composition | 54.28 | 43.51 |
| Casty CDP capture round trip, including Land | 83.02 | 68.05 |
| Casty frame forwarding | 0.61 | 0.14 |
| Bunterm image creation | 27.69 | 5.98 |
| Bunterm render, including framebuffer flush | 37.07 | 39.17 |

Raw Land stages: compose20.80 ms, BGRA-to-RGBA12.79 ms, file write9.91 ms.
Timings overlap and contain nested work; do not sum the table into latency.
`make-file-image` in the raw measurement means CanvasKit MakeImage, not file
I/O. Casty's `bytes` metric inherited a base64-length estimate and is not valid
for the JSON descriptor; actual raw pixels are 7,948,800 bytes. Bunterm's
image-creation timer excludes the Kitty parser's file read.

One final undelivered file survived forced worker shutdown and was manually
removed after the run. Normal renderer close cleans its directory, but a
production version needs producer-process cleanup even when its worker is
terminated without running close. This is one reason this remains experimental.

`bun test tests/experiments/raw-file/patch.test.js` verifies unique files,
cleanup, direct/fallback rendering, and unchanged PNG output. Remote harness
and complete timings are archived in `/root/land-performance-handoff/` inside
the Debian chroot. Temporary runtime changes are restored after measurement.

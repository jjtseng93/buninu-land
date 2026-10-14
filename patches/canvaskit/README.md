# Inherited CanvasKit loader patch

The JavaScript loader is copied unchanged from buninu-browser, but differs from
`canvaskit-wasm@0.41.1`'s `package/bin/canvaskit.js`. `wasm-binary.patch` records
the inherited changes: honor an explicitly supplied `wasmBinary` before fetch
and bypass streaming instantiation when those bytes are supplied. This lets Bun
load the separately distributed WASM without relying on browser fetch behavior.
The patch is documentation only; users do not apply patches or build anything.

SHA-256:

- Official JS: `1336e9130e2b7644cb1b36562e720efdf61fbca4dc048e040aaf2de0872fb999`
- Distributed JS: `d8ed15482165988891938e2ecada05fad51ac1a79a4ae302cb3a8f3bff87f4e1`
- Official and distributed WASM: `bd669c88bd033eaf62d673103a42231a737c6d12e4cc99f8548b2784b5772430`

The locally cached official tarball was verified against npm's published
SHA-512 integrity value. The BSD license remains in `vendor/canvaskit/LICENSE`.

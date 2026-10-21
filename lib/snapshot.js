// A fresh, compositor-owned copy. After filling, snapshots are immutable: workers
// may share them, but never receive writable client SHM or DMA-BUF mappings.
export function allocateSnapshot(length) {
  return typeof SharedArrayBuffer === "function"
    ? Buffer.from(new SharedArrayBuffer(length))
    : Buffer.alloc(length);
}

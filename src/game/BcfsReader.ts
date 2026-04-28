/**
 * Parse Guitar Pro 6/7/8 BCFS/BCFZ container files.
 *
 * BCFS = uncompressed file system (GP6 .gpx).
 * BCFZ = BCFS compressed with a custom LZ algorithm (GP7/8 .gp).
 *
 * Format reverse-engineered from @coderline/alphatab GpxFileSystem source.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

function getUint32LE(data: Uint8Array, off: number): number {
  return (
    data[off] | (data[off + 1] << 8) | (data[off + 2] << 16) | (data[off + 3] * 0x1000000)
  ) >>> 0;
}

function getString(data: Uint8Array, off: number, maxLen: number): string {
  let s = '';
  for (let i = 0; i < maxLen; i++) {
    const c = data[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s;
}

// ── BCFZ decompressor ────────────────────────────────────────────────────────
// Custom LZ77 variant used by Guitar Pro. Bit stream, MSB-first per byte.
// After the 4-byte "BCFZ" magic, the stream starts with a uint32LE giving the
// expected decompressed length, followed by the compressed bit stream.

function decompressBcfz(bytes: Uint8Array, startAt: number): Uint8Array {
  const expectedLen = getUint32LE(bytes, startAt);
  let pos = startAt + 4;
  let curByte = 0;
  let bitOff = 8; // forces a byte read on the first readBit call

  const readBit = (): number => {
    if (bitOff >= 8) {
      curByte = bytes[pos++] ?? 0;
      bitOff = 0;
    }
    return (curByte >> (7 - bitOff++)) & 1;
  };

  // MSB-first: bit (n-1) first, down to bit 0
  const readBits = (n: number): number => {
    let v = 0;
    for (let i = n - 1; i >= 0; i--) v |= readBit() << i;
    return v;
  };

  // LSB-first: bit 0 first, up to bit (n-1)
  const readBitsRev = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++) v |= readBit() << i;
    return v;
  };

  const out: number[] = [];

  try {
    while (out.length < expectedLen) {
      const flag = readBits(1);
      if (flag === 1) {
        // back-reference: copy from already-decompressed output
        const ws = readBits(4);
        if (ws === 0) continue;
        const offset = readBitsRev(ws);
        const size   = readBitsRev(ws);
        const srcPos = out.length - offset;
        const n      = Math.min(offset, size);
        for (let i = 0; i < n; i++) out.push(out[srcPos + i] ?? 0);
      } else {
        // literal run: 0–3 raw bytes
        const size = readBitsRev(2);
        for (let i = 0; i < size; i++) out.push(readBits(8));
      }
    }
  } catch {
    // normal EOF
  }

  // The decompressed output starts with "BCFS" (4 bytes) — skip it so the
  // result can be passed directly to parseBcfs (which expects header-free data).
  return new Uint8Array(out).subarray(4);
}

// ── BCFS parser ───────────────────────────────────────────────────────────────

function parseBcfs(data: Uint8Array): Map<string, Uint8Array> {
  // `data` starts immediately after the 4-byte "BCFS" header.
  // Sector 0 (bytes 0..0x0FFF) is an empty padding sector.
  // Entries begin at sector 1 (offset 0x1000).
  const S = 0x1000;
  const files = new Map<string, Uint8Array>();
  let off = S;

  while (off + 4 <= data.length) {
    const type = getUint32LE(data, off);
    if (type === 2) {
      const name     = getString(data, off + 0x04, 127);
      const fileSize = getUint32LE(data, off + 0x8c);

      const chunks: Uint8Array[] = [];
      let pi = 0;
      let lastSec = 0;

      while (off + 0x94 + pi * 4 + 4 <= data.length) {
        const sec = getUint32LE(data, off + 0x94 + pi++ * 4);
        if (sec === 0) break;
        const secStart = sec * S;
        lastSec = secStart;
        const secEnd = Math.min(secStart + S, data.length);
        if (secStart < data.length) chunks.push(data.subarray(secStart, secEnd));
      }

      // Mirror alphatab: advance outer offset to the last data sector so the
      // outer loop increments past it on the next iteration.
      if (lastSec > 0) off = lastSec;

      if (name && fileSize > 0 && chunks.length > 0) {
        const total = chunks.reduce((a, c) => a + c.length, 0);
        const flat  = new Uint8Array(total);
        let p = 0;
        for (const c of chunks) { flat.set(c, p); p += c.length; }
        files.set(name, flat.subarray(0, Math.min(fileSize, total)));
      }
    }
    off += S;
  }

  return files;
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Parse a BCFS or BCFZ Guitar Pro 6/7/8 container.
 * Returns a map of (filename → data) for all files in the archive,
 * or null if the bytes do not start with a recognised container header.
 */
export function readBcfsContainer(bytes: Uint8Array): Map<string, Uint8Array> | null {
  if (bytes.length < 4) return null;
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);

  if (magic === 'BCFS') {
    return parseBcfs(bytes.subarray(4));
  }
  if (magic === 'BCFZ') {
    try {
      const decompressed = decompressBcfz(bytes, 4);
      return parseBcfs(decompressed);
    } catch {
      return null;
    }
  }
  return null;
}

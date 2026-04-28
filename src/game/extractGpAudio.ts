import { readBcfsContainer } from './BcfsReader';

export interface EmbeddedAudioTrack {
  name: string;
  url: string;
  mimeType: string;
}

const MIME: Record<string, string> = {
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
};

function mimeFor(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'audio/octet-stream';
}

// ── ZIP reader (GP7/8 .gp files are standard ZIP) ──────────────────────────

const ZIP_LOCAL_SIG   = 0x04034b50;
const ZIP_DEFLATE     = 8;
const ZIP_STORED      = 0;
const ZIP_DATA_DESC   = 0x08074b50;

async function decompressRawDeflate(data: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(data.slice());
  writer.close();

  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }

  const total = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

async function extractFromZip(bytes: Uint8Array): Promise<EmbeddedAudioTrack[]> {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tracks: EmbeddedAudioTrack[] = [];
  let pos = 0;

  while (pos + 30 <= bytes.length) {
    const sig = dv.getUint32(pos, true);
    if (sig !== ZIP_LOCAL_SIG) break;

    const flags           = dv.getUint16(pos + 6,  true);
    const method          = dv.getUint16(pos + 8,  true);
    let   compressedSize  = dv.getUint32(pos + 18, true);
    const uncompressedSize = dv.getUint32(pos + 22, true);
    const nameLen         = dv.getUint16(pos + 26, true);
    const extraLen        = dv.getUint16(pos + 28, true);

    const nameBytes = bytes.subarray(pos + 30, pos + 30 + nameLen);
    const name      = new TextDecoder('utf-8').decode(nameBytes);
    const dataStart = pos + 30 + nameLen + extraLen;

    const isAudio = /\.(ogg|mp3|wav)$/i.test(name);

    if (isAudio && (method === ZIP_STORED || method === ZIP_DEFLATE)) {
      try {
        let data: Uint8Array;
        if (method === ZIP_STORED) {
          data = bytes.slice(dataStart, dataStart + uncompressedSize);
        } else {
          // If bit 3 is set, sizes may be 0 in the local header.
          // In that case we can't slice correctly; skip this entry.
          if ((flags & 8) !== 0 && compressedSize === 0) {
            pos = dataStart;
            continue;
          }
          const compressed = bytes.slice(dataStart, dataStart + compressedSize);
          data = await decompressRawDeflate(compressed);
        }
        const mimeType = mimeFor(name);
        const url = URL.createObjectURL(new Blob([data.slice()], { type: mimeType }));
        tracks.push({ name, url, mimeType });
      } catch {
        // decompression failed — skip entry
      }
    }

    // Advance past compressed data
    if (method !== ZIP_STORED && compressedSize === 0 && (flags & 8) !== 0) {
      // Can't determine size; bail out of scan
      break;
    }
    pos = dataStart + compressedSize;

    // Skip optional data descriptor
    if ((flags & 8) !== 0) {
      if (pos + 4 <= bytes.length && dv.getUint32(pos, true) === ZIP_DATA_DESC) {
        pos += 16; // sig + crc + comp_size + uncomp_size
      } else {
        pos += 12; // crc + comp_size + uncomp_size
      }
    }
  }

  return tracks.sort((a, b) => a.name.localeCompare(b.name));
}

// ── BCFS/BCFZ reader (GP6 .gpx files) ─────────────────────────────────────

function extractFromBcfs(bytes: Uint8Array): EmbeddedAudioTrack[] {
  const container = readBcfsContainer(bytes);
  if (!container) return [];

  const tracks: EmbeddedAudioTrack[] = [];
  for (const [name, data] of container) {
    if (!/^(audio|Content)\//i.test(name)) continue;
    if (!/\.(ogg|wav|mp3)$/i.test(name)) continue;
    const mimeType = mimeFor(name);
    const url = URL.createObjectURL(new Blob([data.slice()], { type: mimeType }));
    tracks.push({ name, url, mimeType });
  }
  return tracks.sort((a, b) => a.name.localeCompare(b.name));
}

// ── public API ─────────────────────────────────────────────────────────────

/**
 * Given raw GP file bytes, extract any embedded audio tracks.
 * - GP7/8 `.gp` files: parsed as ZIP (standard format)
 * - GP6 `.gpx` files: parsed as BCFS/BCFZ container
 * - GP3–5: returns empty array (no container)
 */
export async function extractGpAudio(bytes: Uint8Array): Promise<EmbeddedAudioTrack[]> {
  if (bytes.length < 4) return [];

  // ZIP magic: PK\x03\x04
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return extractFromZip(bytes);
  }

  // BCFS/BCFZ magic
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic === 'BCFS' || magic === 'BCFZ') {
    return extractFromBcfs(bytes);
  }

  return [];
}

/** Revoke all blob URLs created by extractGpAudio to free memory. */
export function revokeGpAudioUrls(tracks: EmbeddedAudioTrack[]): void {
  for (const t of tracks) URL.revokeObjectURL(t.url);
}

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

/**
 * Given raw GP file bytes, extract any embedded audio tracks from the BCFS/BCFZ
 * container (GP6–8 only). Returns blob URLs ready for use in an HTMLAudioElement.
 * Returns an empty array for GP3–5 files (no container) or containers with no audio.
 */
export function extractGpAudio(bytes: Uint8Array): EmbeddedAudioTrack[] {
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

/** Revoke all blob URLs created by extractGpAudio to free memory. */
export function revokeGpAudioUrls(tracks: EmbeddedAudioTrack[]): void {
  for (const t of tracks) URL.revokeObjectURL(t.url);
}

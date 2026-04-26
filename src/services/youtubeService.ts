/**
 * YouTube download service
 * Uses ytdl-core (Node) in Electron main process via IPC,
 * or fetches via a cloud proxy in browser mode
 */

export interface YouTubeVideoInfo {
  title: string;
  author: string;
  lengthSeconds: number;
  thumbnailUrl: string;
}

/**
 * Extract YouTube video ID from various URL formats
 */
export function extractVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Validate YouTube URL format
 */
export function isValidYouTubeUrl(url: string): boolean {
  return extractVideoId(url) !== null;
}

/**
 * Get video info (title, duration) from YouTube
 * Note: In Electron, this should run in main process via ytdl-core
 * In browser, we'd need a proxy or use YouTube's oembed API
 */
export async function getVideoInfo(url: string): Promise<YouTubeVideoInfo> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  // Use YouTube oembed API (publicly accessible, no auth needed)
  const oembedUrl = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;

  try {
    const response = await fetch(oembedUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch video info: ${response.statusText}`);
    }

    const data = await response.json();
    return {
      title: data.title,
      author: data.author_name,
      lengthSeconds: 0, // oembed doesn't provide duration
      thumbnailUrl: data.thumbnail_url,
    };
  } catch (error) {
    throw new Error(
      `Could not retrieve video info: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
  }
}

/**
 * Download audio from YouTube video.
 * Returns audio bytes + actual file extension produced by yt-dlp (e.g. ".m4a", ".webm").
 * In Electron: spawns yt-dlp via IPC.
 * In browser: not supported (CORS).
 */
export async function downloadAudio(
  url: string,
  onProgress?: (percent: number) => void
): Promise<{ data: Uint8Array; extension: string }> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    throw new Error('Invalid YouTube URL');
  }

  const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
  if (!isElectron) {
    throw new Error('YouTube download requires Electron. Browser mode not yet supported.');
  }

  return await (window as any).electronAPI.downloadYouTubeAudio(url, onProgress);
}

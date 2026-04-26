import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script: exposes safe APIs to the renderer process
 * via contextBridge. This allows React to call Electron main
 * process functions without nodeIntegration enabled.
 */

contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * Download audio from YouTube URL via yt-dlp in main process.
   * Returns raw audio bytes plus the actual file extension yt-dlp produced
   * (so the caller can save it with the correct extension).
   */
  downloadYouTubeAudio: async (
    url: string,
    onProgress?: (percent: number) => void
  ): Promise<{ data: Uint8Array; extension: string }> => {
    if (onProgress) {
      ipcRenderer.on('youtube-download-progress', (_event, percent: number) => {
        onProgress(percent);
      });
    }
    try {
      const result = await ipcRenderer.invoke('download-youtube-audio', url);
      return { data: new Uint8Array(result.data), extension: result.extension };
    } finally {
      ipcRenderer.removeAllListeners('youtube-download-progress');
    }
  },

  /**
   * Transcribe audio via the Rust CLI.
   * Pass either `inputData` (from a file upload) or `inputPath` (from YouTube download cached on disk).
   */
  transcribeAudio: async (
    options: {
      inputData?: Uint8Array;
      inputPath?: string;
      inputFilename?: string;
      useAi?: boolean;
      polyphonic?: boolean;
      instrument?: 'guitar' | 'bass';
      cleanDrums?: boolean;
    },
    onProgress?: (line: string) => void
  ): Promise<{
    notes: Array<{ fret: number; string: number; stringName: string; time: number; duration: number; frequency: number }>;
    tempo: number;
    timeSignature: { numerator: number; denominator: number };
    gp4Data: Uint8Array;
    gp4Path: string;
  }> => {
    if (onProgress) {
      ipcRenderer.on('transcribe-progress', (_event, line: string) => onProgress(line));
    }
    try {
      const ipcOptions = {
        ...options,
        inputData: options.inputData ? Array.from(options.inputData) : undefined,
      };
      const result = await ipcRenderer.invoke('transcribe-audio', ipcOptions);
      return {
        ...result,
        gp4Data: new Uint8Array(result.gp4Data),
      };
    } finally {
      ipcRenderer.removeAllListeners('transcribe-progress');
    }
  },

  /**
   * Show save dialog for GP4 file
   */
  saveGp4File: async (data: Uint8Array, defaultName: string): Promise<string | null> => {
    return await ipcRenderer.invoke('save-gp4-file', Array.from(data), defaultName);
  },

  /**
   * Get video metadata from YouTube URL
   */
  getYouTubeInfo: async (
    url: string
  ): Promise<{ title: string; author: string; lengthSeconds: number }> => {
    return await ipcRenderer.invoke('get-youtube-info', url);
  },

  /** Search gprotab.net for tab files. Returns up to 30 results. */
  gprotabSearch: async (
    query: string
  ): Promise<Array<{ artist: string; title: string; url: string }>> => {
    return await ipcRenderer.invoke('gprotab-search', query);
  },

  /** Download a gprotab.net tab file by its tab page URL. */
  gprotabDownload: async (
    tabUrl: string
  ): Promise<{ data: Uint8Array; filename: string }> => {
    const result = await ipcRenderer.invoke('gprotab-download', tabUrl);
    return { data: new Uint8Array(result.data), filename: result.filename };
  },
});

// Type definitions for TypeScript users
export interface DetectedNote {
  fret: number;
  string: number;
  stringName: string;
  time: number;
  duration: number;
  frequency: number;
}

export interface TranscribeResult {
  notes: DetectedNote[];
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  instrument: 'guitar' | 'bass';
  gp4Data: Uint8Array;
  gp4Path: string;
}

declare global {
  interface Window {
    electronAPI: {
      downloadYouTubeAudio: (
        url: string,
        onProgress?: (percent: number) => void
      ) => Promise<{ data: Uint8Array; extension: string }>;
      transcribeAudio: (
        options: {
          inputData?: Uint8Array;
          inputPath?: string;
          inputFilename?: string;
          useAi?: boolean;
          polyphonic?: boolean;
          instrument?: 'guitar' | 'bass';
        },
        onProgress?: (line: string) => void
      ) => Promise<TranscribeResult>;
      saveGp4File: (data: Uint8Array, defaultName: string) => Promise<string | null>;
      getYouTubeInfo: (url: string) => Promise<{
        title: string;
        author: string;
        lengthSeconds: number;
      }>;
      gprotabSearch: (
        query: string
      ) => Promise<Array<{ artist: string; title: string; url: string }>>;
      gprotabDownload: (
        tabUrl: string
      ) => Promise<{ data: Uint8Array; filename: string }>;
    };
  }
}

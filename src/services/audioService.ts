/**
 * Audio transcription service.
 *
 * Previously this module used ffmpeg.wasm + a Web Worker for pitch detection.
 * We now delegate everything to the Rust `transcribe` CLI via Electron IPC —
 * the Rust binary does audio decode, onset detection, pitch detection, smart
 * fret placement, and GP4 writing in one pass.
 */

export interface DetectedNote {
  fret: number;
  string: number;
  stringName: string;
  time: number;
  duration: number;
  frequency: number;
}

export interface ConversionResult {
  notes: DetectedNote[];
  tempo: number;
  timeSignature: { numerator: number; denominator: number };
  instrument: 'guitar' | 'bass';
  gp4Data: Uint8Array;
  gp4Path: string;
}

export interface ProcessOptions {
  useAi?: boolean;
  polyphonic?: boolean;
  instrument?: 'guitar' | 'bass';
  cleanDrums?: boolean;
}

function getElectronAPI() {
  const api = (window as any).electronAPI;
  if (!api) {
    throw new Error(
      'Electron API not available. This app must run inside the Electron shell.'
    );
  }
  return api;
}

/**
 * Transcribe raw audio bytes to notes + GP4.
 * Used for uploaded local files.
 */
export async function processAudio(
  fileData: Uint8Array,
  filename: string,
  onProgress: (percent: number) => void,
  options: ProcessOptions = {}
): Promise<ConversionResult> {
  onProgress(5);

  const api = getElectronAPI();
  let lastPct = 5;

  const result = await api.transcribeAudio(
    {
      inputData: fileData,
      inputFilename: filename,
      useAi: options.useAi,
      polyphonic: options.polyphonic,
      instrument: options.instrument,
      cleanDrums: options.cleanDrums,
    },
    (line: string) => {
      // Best-effort progress tracking from stdout lines
      if (/decoded/i.test(line)) lastPct = 20;
      else if (/onsets/i.test(line)) lastPct = 40;
      else if (/notes/i.test(line)) lastPct = 75;
      else if (/wrote/i.test(line)) lastPct = 95;
      onProgress(lastPct);
    }
  );

  onProgress(100);
  return result;
}

/**
 * Transcribe audio that already lives on disk (e.g., a YouTube download).
 * inputPath must be readable by the Electron main process.
 */
export async function processAudioFile(
  inputPath: string,
  onProgress: (percent: number) => void,
  options: ProcessOptions = {}
): Promise<ConversionResult> {
  onProgress(5);

  const api = getElectronAPI();
  let lastPct = 5;

  const result = await api.transcribeAudio(
    {
      inputPath,
      useAi: options.useAi,
      polyphonic: options.polyphonic,
      instrument: options.instrument,
      cleanDrums: options.cleanDrums,
    },
    (line: string) => {
      if (/decoded/i.test(line)) lastPct = 20;
      else if (/onsets/i.test(line)) lastPct = 40;
      else if (/notes/i.test(line)) lastPct = 75;
      else if (/wrote/i.test(line)) lastPct = 95;
      onProgress(lastPct);
    }
  );

  onProgress(100);
  return result;
}

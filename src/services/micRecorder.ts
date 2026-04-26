/**
 * Microphone recorder for the Music-to-Notes tab.
 *
 * Captures Float32 mono audio via Web Audio API (NOT MediaRecorder, whose
 * output is usually Opus/WebM — which our decoder can't handle), then
 * encodes the samples to a 16-bit PCM WAV blob suitable for the existing
 * `processAudio` pipeline.
 *
 * Use:
 *   const rec = new MicRecorder();
 *   await rec.start({ onLevel: (rms) => ... });
 *   ...
 *   const wav = await rec.stop();   // Uint8Array, ready for processAudio
 *   rec.dispose();
 */

export interface MicRecorderOptions {
  /** Called on each audio frame with the current RMS level (0..1). */
  onLevel?: (rms: number) => void;
  /** Called when the recording reaches max duration (auto-stops). */
  onMaxDuration?: () => void;
  /** Hard cap on recording length, default 5 minutes. */
  maxDurationSec?: number;
}

export class MicRecorder {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private chunks: Float32Array[] = [];
  private sampleRate = 44100;
  private startedAt = 0;
  private maxDurationSec = 300;
  private autoStopTimer: number | null = null;
  private onLevel?: (rms: number) => void;

  /** Returns true once `start` has resolved and audio is being captured. */
  isRecording(): boolean {
    return this.processor !== null;
  }

  /** ms of audio captured so far. */
  durationMs(): number {
    if (!this.startedAt) return 0;
    return performance.now() - this.startedAt;
  }

  async start(opts: MicRecorderOptions = {}): Promise<void> {
    if (this.processor) throw new Error('MicRecorder is already running');

    this.maxDurationSec = opts.maxDurationSec ?? 300;
    this.onLevel = opts.onLevel;

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });

    this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    this.sampleRate = this.ctx.sampleRate;

    this.source = this.ctx.createMediaStreamSource(this.stream);
    // ScriptProcessorNode is deprecated but still works in Chromium and is
    // dramatically simpler than wiring an AudioWorklet. For a one-shot
    // recorder this is fine; if it ever stops working we'll port to an
    // AudioWorkletNode.
    const bufferSize = 4096;
    this.processor = this.ctx.createScriptProcessor(bufferSize, 1, 1);
    this.processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      // Copy — the underlying Float32Array is reused by the engine.
      this.chunks.push(new Float32Array(input));
      if (this.onLevel) {
        let sumSq = 0;
        for (let i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        this.onLevel(Math.sqrt(sumSq / input.length));
      }
    };

    this.source.connect(this.processor);
    // Required to actually pump samples through ScriptProcessor — connect to
    // destination via a muted GainNode so we don't blast the mic into the
    // speakers.
    const muteGain = this.ctx.createGain();
    muteGain.gain.value = 0;
    this.processor.connect(muteGain);
    muteGain.connect(this.ctx.destination);

    this.startedAt = performance.now();
    if (this.maxDurationSec > 0) {
      this.autoStopTimer = window.setTimeout(() => {
        opts.onMaxDuration?.();
      }, this.maxDurationSec * 1000);
    }
  }

  /** Stop, encode the captured audio to WAV, return the bytes. */
  async stop(): Promise<Uint8Array> {
    if (!this.processor) throw new Error('MicRecorder is not running');
    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    try { this.processor.disconnect(); } catch {}
    try { this.source?.disconnect(); } catch {}
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try { t.stop(); } catch {}
      }
    }
    this.processor = null;
    this.source = null;
    this.stream = null;

    const samples = concatFloat32(this.chunks);
    const wav = encodeWav16(samples, this.sampleRate);
    this.chunks = [];

    return wav;
  }

  /** Tear down without producing a WAV (e.g., user cancelled). */
  dispose(): void {
    if (this.autoStopTimer !== null) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    try { this.processor?.disconnect(); } catch {}
    try { this.source?.disconnect(); } catch {}
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try { t.stop(); } catch {}
      }
    }
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
    }
    this.processor = null;
    this.source = null;
    this.stream = null;
    this.ctx = null;
    this.chunks = [];
  }
}

function concatFloat32(parts: Float32Array[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Encode mono Float32 samples [-1..1] as a 16-bit PCM WAV file. */
function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const byteLen = samples.length * 2;
  const buffer = new ArrayBuffer(44 + byteLen);
  const view = new DataView(buffer);

  // RIFF header
  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + byteLen, true);
  writeAscii(view, 8, 'WAVE');
  // fmt chunk
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);   // PCM
  view.setUint16(22, 1, true);   // channels
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate
  view.setUint16(32, 2, true);   // block align
  view.setUint16(34, 16, true);  // bits per sample
  // data chunk
  writeAscii(view, 36, 'data');
  view.setUint32(40, byteLen, true);

  // Samples — clamp + scale to int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

function writeAscii(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

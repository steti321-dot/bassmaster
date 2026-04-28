import FFT from 'fft.js';

export interface DetectedPitch {
  frequency: number;
  confidence: number;
}

export interface PolyphonicDetectorConfig {
  fftSize?: number;
  maxPitches?: number;
}

// 1 semitone in frequency ratio — minimum separation between returned peaks.
// Prevents picking up spectral leakage (same note smeared across adjacent bins)
// without filtering real chord tones (smallest chord interval is a minor 2nd ≈ 5.9%).
const ONE_SEMITONE_RATIO = 1 - 1 / Math.pow(2, 1 / 12); // ≈ 0.0561

class PolyphonicDetector {
  public readonly maxPitches: number;
  private readonly fftSize: number;
  private readonly fft: FFT;
  private readonly hannWindow: Float32Array;

  constructor(config: PolyphonicDetectorConfig = {}) {
    this.fftSize = config.fftSize || 16384;
    this.maxPitches = config.maxPitches || 6;
    this.fft = new FFT(this.fftSize);
    this.hannWindow = this.buildHannWindow(this.fftSize);
  }

  private buildHannWindow(size: number): Float32Array {
    const w = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return w;
  }

  detect(
    samples: Float32Array,
    sampleRate: number,
    minFreq: number,
    maxFreq: number
  ): DetectedPitch[] {
    // Window samples and zero-pad to fftSize
    const windowed = new Float32Array(this.fftSize);
    const copyLen = Math.min(samples.length, this.fftSize);
    for (let i = 0; i < copyLen; i++) {
      windowed[i] = samples[i] * this.hannWindow[i];
    }

    const spectrum = this.fft.createComplexArray();
    this.fft.realTransform(spectrum, windowed);

    const numBins = this.fftSize / 2;
    const magnitudes = this.computeMagnitudes(spectrum, numBins);
    const binFreq = sampleRate / this.fftSize;
    const minBin = Math.ceil(minFreq / binFreq);
    const maxBin = Math.floor(Math.min(maxFreq / binFreq, numBins - 2));

    // 30th-percentile magnitude as noise floor — more robust than median when
    // a full 6-string strum fills many bins with real energy.
    const noiseFloor = this.percentileMag(magnitudes, minBin, maxBin, 0.30);

    // Collect all local maxima above the noise floor with parabolic interpolation
    const peaks: Array<{ frequency: number; magnitude: number }> = [];
    for (let bin = minBin + 1; bin < maxBin; bin++) {
      const mag = magnitudes[bin];
      if (mag > magnitudes[bin - 1] && mag > magnitudes[bin + 1] && mag > noiseFloor) {
        const left = magnitudes[bin - 1];
        const right = magnitudes[bin + 1];
        const denom = 2 * mag - left - right;
        const delta = denom !== 0 ? 0.5 * (right - left) / denom : 0;
        peaks.push({ frequency: (bin + delta) * binFreq, magnitude: mag });
      }
    }

    // Sort by magnitude descending
    peaks.sort((a, b) => b.magnitude - a.magnitude);

    // Greedy minimum-separation selection:
    // Pick the strongest peak, then skip any remaining peak within 1 semitone
    // of an already-selected peak.  This removes spectral leakage duplicates
    // without ever filtering octave/5th chord tones (which are further apart).
    // We intentionally do NOT apply harmonic filtering here — chord tones
    // (e.g. E2 + E4 in a full strum) are at exact harmonic ratios and would
    // be incorrectly removed by a ratio-based filter.  The game's scoring loop
    // already acts as the harmonic filter: it only awards hits for frequencies
    // that match a note in the current song.
    const selected: Array<{ frequency: number; magnitude: number }> = [];
    for (const peak of peaks) {
      const tooClose = selected.some(
        s =>
          Math.abs(s.frequency - peak.frequency) <
          Math.min(s.frequency, peak.frequency) * ONE_SEMITONE_RATIO
      );
      if (!tooClose) selected.push(peak);
      if (selected.length >= this.maxPitches) break;
    }

    // Normalize confidence relative to noise floor so that weaker treble
    // strings aren't gated out solely because bass strings dominate.
    let maxMag = noiseFloor + 1e-8;
    for (const p of selected) if (p.magnitude > maxMag) maxMag = p.magnitude;
    const scale = maxMag - noiseFloor;

    return selected.map(p => ({
      frequency: p.frequency,
      confidence: Math.min(1, (p.magnitude - noiseFloor) / scale),
    }));
  }

  private computeMagnitudes(spectrum: any, numBins: number): Float32Array {
    const mag = new Float32Array(numBins);
    for (let i = 0; i < numBins; i++) {
      const re = spectrum[2 * i];
      const im = spectrum[2 * i + 1];
      mag[i] = Math.sqrt(re * re + im * im);
    }
    return mag;
  }

  // Compute the Nth percentile magnitude within [minBin, maxBin] using a
  // partial sort. Avoids the call-stack overflow from Math.max(...Float32Array)
  // on 16k-element arrays.
  private percentileMag(
    magnitudes: Float32Array,
    minBin: number,
    maxBin: number,
    pct: number
  ): number {
    const slice: number[] = [];
    for (let i = minBin; i <= maxBin; i++) slice.push(magnitudes[i]);
    slice.sort((a, b) => a - b);
    return slice[Math.floor(pct * (slice.length - 1))];
  }
}

// Module-level singleton; recreated only when maxPitches changes.
let detector: PolyphonicDetector | null = null;

export function detectPolyphonicPitches(
  samples: Float32Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
  maxPitches = 6
): DetectedPitch[] {
  if (!detector || detector.maxPitches !== maxPitches) {
    detector = new PolyphonicDetector({ fftSize: 16384, maxPitches });
  }
  // Threshold 0.2 allows weaker high-e strings to register; the scoring loop
  // still requires frequency proximity to an expected note, so false positives
  // from low-confidence noise don't produce incorrect game hits.
  return detector
    .detect(samples, sampleRate, minFreq, maxFreq)
    .filter(p => p.confidence >= 0.2);
}

export function createPolyphonicDetector(
  config?: PolyphonicDetectorConfig
): PolyphonicDetector {
  return new PolyphonicDetector(config);
}

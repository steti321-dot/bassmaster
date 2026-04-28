import FFT from 'fft.js';

export interface DetectedPitch {
  frequency: number;
  confidence: number;
}

export interface PolyphonicDetectorConfig {
  fftSize?: number;
  maxPitches?: number;
  confidenceThreshold?: number;
  harmonicRatioThreshold?: number;
}

class PolyphonicDetector {
  private fftSize: number;
  public maxPitches: number;
  private confidenceThreshold: number;
  private harmonicRatioThreshold: number;
  private fft: FFT;
  private hannWindow: Float32Array;

  constructor(config: PolyphonicDetectorConfig = {}) {
    this.fftSize = config.fftSize || 8192;
    this.maxPitches = config.maxPitches || 3;
    this.confidenceThreshold = config.confidenceThreshold || 0.4;
    this.harmonicRatioThreshold = config.harmonicRatioThreshold || 0.6;

    this.fft = new FFT(this.fftSize);
    this.hannWindow = this.createHannWindow(this.fftSize);
  }

  private createHannWindow(size: number): Float32Array {
    const window = new Float32Array(size);
    for (let i = 0; i < size; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)));
    }
    return window;
  }

  detect(
    samples: Float32Array,
    sampleRate: number,
    minFreq: number,
    maxFreq: number
  ): DetectedPitch[] {
    // Zero-pad and apply window
    const paddedSamples = new Float32Array(this.fftSize);
    const windowedSamples = new Float32Array(this.fftSize);

    const copyLen = Math.min(samples.length, this.fftSize);
    for (let i = 0; i < copyLen; i++) {
      windowedSamples[i] = samples[i] * this.hannWindow[i];
    }

    // Compute FFT (real FFT via interleaved input)
    const spectrum = this.fft.createComplexArray();
    this.fft.realTransform(spectrum, windowedSamples);

    // Convert to magnitude spectrum
    const magnitudes = this.computeMagnitudes(spectrum);

    // Find peaks in the frequency range
    const peaks = this.findPeaks(magnitudes, sampleRate, minFreq, maxFreq);

    // Filter out harmonics
    const fundamentals = this.filterHarmonics(peaks, sampleRate);

    // Score confidence and sort
    const scored = fundamentals.map((peak) => ({
      frequency: peak.frequency,
      confidence: peak.confidence,
    }));

    scored.sort((a, b) => b.confidence - a.confidence);
    return scored.slice(0, this.maxPitches);
  }

  private computeMagnitudes(spectrum: any): Float32Array {
    const magnitudes = new Float32Array(spectrum.length / 2);
    for (let i = 0; i < magnitudes.length; i++) {
      const real = spectrum[2 * i];
      const imag = spectrum[2 * i + 1];
      magnitudes[i] = Math.sqrt(real * real + imag * imag);
    }
    return magnitudes;
  }

  private findPeaks(
    magnitudes: Float32Array,
    sampleRate: number,
    minFreq: number,
    maxFreq: number
  ): Array<{ bin: number; frequency: number; magnitude: number }> {
    const binFreq = sampleRate / this.fftSize;
    const minBin = Math.ceil(minFreq / binFreq);
    const maxBin = Math.floor(maxFreq / binFreq);

    const noiseFloor = this.estimateNoiseFloor(magnitudes) * 0.1; // 10% of noise floor
    const maxMagnitude = Math.max(...magnitudes);

    const peaks: Array<{
      bin: number;
      frequency: number;
      magnitude: number;
    }> = [];

    for (let bin = minBin + 1; bin < maxBin - 1; bin++) {
      const mag = magnitudes[bin];

      // Local maximum check
      if (
        mag > magnitudes[bin - 1] &&
        mag > magnitudes[bin + 1] &&
        mag > noiseFloor
      ) {
        // Sub-bin interpolation (parabolic)
        const left = magnitudes[bin - 1];
        const center = mag;
        const right = magnitudes[bin + 1];

        const delta = 0.5 * ((right - left) / (2 * center - left - right));
        const interpBin = bin + delta;

        const frequency = interpBin * binFreq;
        peaks.push({
          bin: interpBin,
          frequency,
          magnitude: mag,
        });
      }
    }

    return peaks;
  }

  private estimateNoiseFloor(magnitudes: Float32Array): number {
    // Use the median as a robust noise floor estimate
    const sorted = Array.from(magnitudes).sort((a, b) => a - b);
    const medianIdx = Math.floor(sorted.length / 2);
    return sorted[medianIdx];
  }

  private filterHarmonics(
    peaks: Array<{ bin: number; frequency: number; magnitude: number }>,
    sampleRate: number
  ): Array<{ frequency: number; confidence: number }> {
    const binFreq = sampleRate / this.fftSize;
    const fundamentals: Array<{
      frequency: number;
      confidence: number;
    }> = [];

    const isProbablyHarmonic = (peakBin: number, otherPeaks: Array<number>) => {
      for (const otherBin of otherPeaks) {
        const ratio = peakBin / otherBin;
        // Check if this peak is a harmonic (2x, 3x, 4x, 5x) of another peak
        for (let h = 2; h <= 5; h++) {
          if (Math.abs(ratio - h) < 0.15) {
            return true; // Likely a harmonic
          }
        }
      }
      return false;
    };

    const allBins = peaks.map((p) => p.bin);
    const maxMagnitude = Math.max(0.1, ...peaks.map((p) => p.magnitude));

    for (const peak of peaks) {
      const otherBins = allBins.filter((b) => Math.abs(b - peak.bin) > 1);

      // Check if stronger fundamental exists at 1/2, 1/3, or 1/4 freq
      let isFundamental = true;
      for (let divisor = 2; divisor <= 4; divisor++) {
        const lowerBin = peak.bin / divisor;
        const closestBin = otherBins.reduce((closest, bin) =>
          Math.abs(bin - lowerBin) < Math.abs(closest - lowerBin) ? bin : closest
        );

        const relatedPeak = peaks.find((p) => Math.abs(p.bin - closestBin) < 0.5);
        if (
          Math.abs(closestBin - lowerBin) < 1 &&
          relatedPeak &&
          relatedPeak.magnitude >= peak.magnitude * this.harmonicRatioThreshold
        ) {
          isFundamental = false;
          break;
        }
      }

      if (isFundamental && !isProbablyHarmonic(peak.bin, otherBins)) {
        const confidence =
          Math.min(1.0, peak.magnitude / maxMagnitude) *
          Math.max(0.3, 1 - Math.abs(peak.bin % 1)); // Interpolation smoothness factor
        fundamentals.push({
          frequency: peak.frequency,
          confidence,
        });
      }
    }

    return fundamentals;
  }
}

let detector: PolyphonicDetector | null = null;

export function detectPolyphonicPitches(
  samples: Float32Array,
  sampleRate: number,
  minFreq: number,
  maxFreq: number,
  maxPitches: number = 3
): DetectedPitch[] {
  if (!detector) {
    detector = new PolyphonicDetector({
      fftSize: 8192,
      maxPitches,
      confidenceThreshold: 0.4,
      harmonicRatioThreshold: 0.6,
    });
  }

  // Update detector config if maxPitches changed
  if (detector.maxPitches !== maxPitches) {
    detector = new PolyphonicDetector({
      fftSize: 8192,
      maxPitches,
      confidenceThreshold: 0.4,
      harmonicRatioThreshold: 0.6,
    });
  }

  const results = detector.detect(samples, sampleRate, minFreq, maxFreq);

  // Filter by confidence threshold
  return results.filter((pitch) => pitch.confidence >= 0.4);
}

export function createPolyphonicDetector(
  config?: PolyphonicDetectorConfig
): PolyphonicDetector {
  return new PolyphonicDetector(config);
}

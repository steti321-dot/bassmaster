/**
 * YIN pitch detection in pure TypeScript.
 * Ported from cli/src/pitch.rs::yin_with_range — same two-tier threshold
 * algorithm. Real-time monophonic detection on Float32 audio buffers.
 *
 * Reference: de Cheveigné & Kawahara, "YIN, a fundamental frequency estimator
 * for speech and music" (2002).
 */

const STRICT_THRESHOLD = 0.15;
const FALLBACK_THRESHOLD = 0.5;

export interface PitchResult {
  /** Detected fundamental frequency in Hz. 0 if no pitch found. */
  frequency: number;
  /** Confidence 0-1: how cleanly the YIN minimum was below threshold. */
  confidence: number;
}

/**
 * Detect the fundamental frequency in a Float32 buffer for the given range.
 *
 * @param samples PCM mono audio, values typically in [-1, 1]
 * @param sampleRate sample rate of the audio
 * @param minFreq lowest frequency to consider (Hz)
 * @param maxFreq highest frequency to consider (Hz)
 */
export function detectPitch(
  samples: Float32Array,
  sampleRate: number,
  minFreq = 70,
  maxFreq = 1500
): PitchResult {
  const minTau = Math.max(2, Math.floor(sampleRate / maxFreq));
  let maxTau = Math.floor(sampleRate / minFreq);
  maxTau = Math.min(maxTau, Math.floor(samples.length / 2));

  if (maxTau <= minTau + 2) return { frequency: 0, confidence: 0 };

  // Step 1: Difference function d[τ] = Σ (s[j] - s[j+τ])²
  const d = new Float32Array(maxTau + 1);
  for (let tau = 1; tau <= maxTau; tau++) {
    let sum = 0;
    const end = samples.length - tau;
    for (let j = 0; j < end; j++) {
      const diff = samples[j] - samples[j + tau];
      sum += diff * diff;
    }
    d[tau] = sum;
  }

  // Step 2: Cumulative mean normalized difference
  const cmnd = new Float32Array(maxTau + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau++) {
    runningSum += d[tau];
    cmnd[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1;
  }

  // Step 3: Pick best τ
  let selected = -1;

  // Strict: first τ that drops below STRICT_THRESHOLD, descend to local minimum
  let tau = minTau;
  while (tau < maxTau) {
    if (cmnd[tau] < STRICT_THRESHOLD) {
      while (tau + 1 < maxTau && cmnd[tau + 1] < cmnd[tau]) tau++;
      selected = tau;
      break;
    }
    tau++;
  }

  // Fallback: global minimum if it's below FALLBACK_THRESHOLD
  if (selected < 0) {
    let minIdx = minTau;
    let minVal = cmnd[minTau];
    for (let t = minTau + 1; t < maxTau; t++) {
      if (cmnd[t] < minVal) {
        minVal = cmnd[t];
        minIdx = t;
      }
    }
    if (minVal < FALLBACK_THRESHOLD) selected = minIdx;
  }

  if (selected < 0) return { frequency: 0, confidence: 0 };

  // Step 4: Parabolic interpolation for sub-sample precision
  let betterTau = selected;
  if (selected > minTau && selected < maxTau) {
    const y0 = cmnd[selected - 1];
    const y1 = cmnd[selected];
    const y2 = cmnd[selected + 1];
    const denom = 2 * (2 * y1 - y0 - y2);
    if (Math.abs(denom) > 1e-9) {
      betterTau = selected + (y2 - y0) / denom;
    }
  }

  if (betterTau <= 0) return { frequency: 0, confidence: 0 };

  return {
    frequency: sampleRate / betterTau,
    // Confidence = 1 minus the CMND at the chosen τ (lower CMND = stronger pitch)
    confidence: Math.max(0, Math.min(1, 1 - cmnd[selected])),
  };
}

/**
 * Convert a frequency in Hz to "cents" relative to a reference.
 * 100 cents = 1 semitone.
 */
export function centsBetween(freq1: number, freq2: number): number {
  if (freq1 <= 0 || freq2 <= 0) return Infinity;
  return 1200 * Math.log2(freq1 / freq2);
}

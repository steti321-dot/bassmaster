//! Polyphonic pitch detection via FFT spectral peak picking.
//!
//! Strategy:
//! 1. Apply Hann window to reduce spectral leakage
//! 2. Zero-pad to next power of 2 and compute FFT
//! 3. Convert to magnitude spectrum
//! 4. Quadratic peak interpolation for sub-bin frequency precision
//! 5. Filter peaks by SNR (above noise floor)
//! 6. Remove harmonics: if peak freq ≈ k × lower_peak, it's a harmonic, not a fundamental
//! 7. Return top N fundamentals sorted by magnitude

use rustfft::{num_complex::Complex, FftPlanner};

/// Detected spectral peak (a candidate fundamental or harmonic).
#[derive(Debug, Clone, Copy)]
pub struct Peak {
    pub frequency: f32,
    pub magnitude: f32,
}

/// Extract fundamentals from samples. Returns up to `max_notes` peaks.
pub fn detect_fundamentals(samples: &[f32], sample_rate: u32, max_notes: usize) -> Vec<Peak> {
    if samples.len() < 512 {
        return vec![];
    }

    // Choose FFT size: next power of 2 ≥ samples.len(), capped for speed
    let fft_size = samples.len().next_power_of_two().min(16384);

    // Apply Hann window + zero-pad
    let mut buffer: Vec<Complex<f32>> = (0..fft_size)
        .map(|i| {
            let windowed = if i < samples.len() {
                let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (samples.len() - 1) as f32).cos();
                samples[i] * w
            } else {
                0.0
            };
            Complex::new(windowed, 0.0)
        })
        .collect();

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);
    fft.process(&mut buffer);

    // Magnitude spectrum (only need first half due to Nyquist)
    let spectrum: Vec<f32> = buffer[..fft_size / 2].iter().map(|c| c.norm()).collect();

    // Find all local maxima above threshold
    let max_mag = spectrum.iter().cloned().fold(0.0f32, f32::max);
    let noise_floor = max_mag * 0.05;

    let freq_per_bin = sample_rate as f32 / fft_size as f32;
    let min_bin = (70.0 / freq_per_bin).ceil() as usize;
    let max_bin = ((1500.0 / freq_per_bin).floor() as usize).min(spectrum.len() - 1);

    let mut raw_peaks: Vec<Peak> = Vec::new();
    for i in min_bin + 1..max_bin {
        if spectrum[i] < noise_floor {
            continue;
        }
        if spectrum[i] > spectrum[i - 1] && spectrum[i] >= spectrum[i + 1] {
            // Parabolic interpolation for sub-bin precision
            let (delta, mag) = parabolic_peak(spectrum[i - 1], spectrum[i], spectrum[i + 1]);
            let freq = (i as f32 + delta) * freq_per_bin;
            if freq > 70.0 && freq < 1500.0 {
                raw_peaks.push(Peak {
                    frequency: freq,
                    magnitude: mag,
                });
            }
        }
    }

    // Sort by frequency ascending so we can remove harmonics of lower peaks
    raw_peaks.sort_by(|a, b| a.frequency.partial_cmp(&b.frequency).unwrap());

    let fundamentals = remove_harmonics(&raw_peaks);

    // Keep top N by magnitude
    let mut sorted = fundamentals;
    sorted.sort_by(|a, b| b.magnitude.partial_cmp(&a.magnitude).unwrap());
    sorted.truncate(max_notes);

    // Return ordered by frequency for consistent output
    sorted.sort_by(|a, b| a.frequency.partial_cmp(&b.frequency).unwrap());
    sorted
}

/// Quadratic peak interpolation — returns (bin_offset, interpolated_magnitude).
fn parabolic_peak(y_prev: f32, y_curr: f32, y_next: f32) -> (f32, f32) {
    let denom = y_prev - 2.0 * y_curr + y_next;
    if denom.abs() < 1e-9 {
        return (0.0, y_curr);
    }
    let delta = 0.5 * (y_prev - y_next) / denom;
    let mag = y_curr - 0.25 * (y_prev - y_next) * delta;
    (delta, mag)
}

/// Filter out peaks that are integer multiples of a stronger lower peak (harmonics).
///
/// Physical fact: when you play note F on a string, you also hear overtones at
/// 2F, 3F, 4F, 5F, ... These are not separate notes. We drop any peak that lies
/// within `HARMONIC_TOLERANCE_CENTS` of k×F for a previously-kept F and is not
/// substantially stronger than F would predict.
fn remove_harmonics(peaks: &[Peak]) -> Vec<Peak> {
    const HARMONIC_TOLERANCE_CENTS: f32 = 35.0;
    let mut fundamentals: Vec<Peak> = Vec::new();

    for p in peaks {
        let mut is_harmonic = false;
        for f in &fundamentals {
            for k in 2..=10 {
                let expected = f.frequency * k as f32;
                if expected > 1600.0 {
                    break;
                }
                let cents = 1200.0 * (p.frequency / expected).log2().abs();
                if cents >= HARMONIC_TOLERANCE_CENTS {
                    continue;
                }
                // Natural harmonic amplitude rolls off roughly like 1/k.
                // A peak at k×F is a "real" note only if it's stronger than
                // ~1.5× the expected harmonic magnitude (fundamental × 1/k).
                let expected_harmonic_mag = f.magnitude / k as f32;
                if p.magnitude < expected_harmonic_mag * 1.5 {
                    is_harmonic = true;
                    break;
                }
            }
            if is_harmonic {
                break;
            }
        }
        if !is_harmonic {
            fundamentals.push(*p);
        }
    }

    fundamentals
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Generate a sum of sine waves (like a chord with pure tones).
    fn sine_chord(freqs: &[f32], sample_rate: u32, duration_sec: f32) -> Vec<f32> {
        let n = (sample_rate as f32 * duration_sec) as usize;
        (0..n)
            .map(|i| {
                let t = i as f32 / sample_rate as f32;
                let sum: f32 = freqs
                    .iter()
                    .map(|&f| (2.0 * std::f32::consts::PI * f * t).sin())
                    .sum();
                sum / freqs.len() as f32 * 0.5
            })
            .collect()
    }

    fn has_peak_near(peaks: &[Peak], target: f32, cents: f32) -> bool {
        peaks.iter().any(|p| {
            let diff_cents = 1200.0 * (p.frequency / target).log2().abs();
            diff_cents < cents
        })
    }

    #[test]
    fn detects_single_note() {
        let samples = sine_chord(&[440.0], 44100, 0.3); // A4
        let peaks = detect_fundamentals(&samples, 44100, 6);
        assert!(!peaks.is_empty(), "expected at least 1 peak");
        assert!(has_peak_near(&peaks, 440.0, 20.0), "missing A4: got {:?}", peaks);
    }

    #[test]
    fn detects_e_major_chord() {
        // E major triad: E3, G#3, B3, E4
        let freqs = [164.81, 207.65, 246.94, 329.63];
        let samples = sine_chord(&freqs, 44100, 0.3);
        let peaks = detect_fundamentals(&samples, 44100, 6);

        for &f in &freqs {
            assert!(
                has_peak_near(&peaks, f, 30.0),
                "missing peak near {:.2}Hz; got {:?}",
                f,
                peaks.iter().map(|p| p.frequency).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn detects_power_chord() {
        // Power chord: E2 (82.41Hz), B2 (123.47Hz), E3 (164.81Hz)
        let freqs = [82.41, 123.47, 164.81];
        let samples = sine_chord(&freqs, 44100, 0.3);
        let peaks = detect_fundamentals(&samples, 44100, 6);

        for &f in &freqs {
            assert!(
                has_peak_near(&peaks, f, 30.0),
                "missing peak near {:.2}Hz; got {:?}",
                f,
                peaks.iter().map(|p| p.frequency).collect::<Vec<_>>()
            );
        }
    }
}

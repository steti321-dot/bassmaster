//! Harmonic-Percussive Source Separation via median filtering on the spectrogram.
//!
//! Reference: Fitzgerald, "Harmonic/Percussive Separation Using Median Filtering" (2010).
//!
//! Idea:
//! 1. Compute STFT magnitude spectrogram.
//! 2. Median-filter along the TIME axis → harmonic component (sustained pitches
//!    survive, transients flatten out).
//! 3. Median-filter along the FREQUENCY axis → percussive component (broadband
//!    transients survive, narrow harmonic ridges flatten out).
//! 4. Build soft Wiener-style masks from the two filtered spectrograms.
//! 5. Apply masks to the original complex spectrogram, inverse-STFT to PCM.
//!
//! Output: `(harmonic_audio, percussive_audio)` — both same length as input.

use rustfft::{num_complex::Complex, FftPlanner};

const FFT_SIZE: usize = 2048;
const HOP: usize = 512; // 75% overlap

/// Separate audio into harmonic and percussive PCM streams.
pub fn separate(samples: &[f32], _sample_rate: u32) -> (Vec<f32>, Vec<f32>) {
    let spec = stft(samples);
    let mags: Vec<Vec<f32>> = spec
        .iter()
        .map(|frame| frame.iter().map(|c| c.norm()).collect())
        .collect();

    // Median filter sizes (in spectrogram bins). 17 ≈ 0.2s at 512-hop / 44.1kHz
    // for the time axis; 17 ≈ 365Hz at 2048-FFT / 44.1kHz for the freq axis.
    let h_mags = median_time(&mags, 17);
    let p_mags = median_freq(&mags, 17);

    // Soft binary mask: harmonic if h > p
    let h_spec = mask_complex(&spec, &h_mags, &p_mags, true);
    let p_spec = mask_complex(&spec, &h_mags, &p_mags, false);

    let h_audio = istft(&h_spec, samples.len());
    let p_audio = istft(&p_spec, samples.len());

    (h_audio, p_audio)
}

/// Short-time Fourier transform with a Hann window.
fn stft(samples: &[f32]) -> Vec<Vec<Complex<f32>>> {
    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(FFT_SIZE);

    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| {
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos()
        })
        .collect();

    let mut frames = Vec::new();
    let mut i: usize = 0;
    while i + FFT_SIZE <= samples.len() {
        let mut buf: Vec<Complex<f32>> = (0..FFT_SIZE)
            .map(|k| Complex::new(samples[i + k] * window[k], 0.0))
            .collect();
        fft.process(&mut buf);
        // Keep only the positive-frequency half (FFT_SIZE/2 + 1)
        buf.truncate(FFT_SIZE / 2 + 1);
        frames.push(buf);
        i += HOP;
    }
    frames
}

/// Inverse STFT via overlap-add.
fn istft(spec: &[Vec<Complex<f32>>], output_len: usize) -> Vec<f32> {
    let mut planner = FftPlanner::<f32>::new();
    let inv_fft = planner.plan_fft_inverse(FFT_SIZE);

    let window: Vec<f32> = (0..FFT_SIZE)
        .map(|i| {
            0.5 - 0.5 * (2.0 * std::f32::consts::PI * i as f32 / (FFT_SIZE - 1) as f32).cos()
        })
        .collect();

    let mut output = vec![0.0f32; output_len + FFT_SIZE];
    let mut window_sum = vec![0.0f32; output_len + FFT_SIZE];

    for (idx, half_spec) in spec.iter().enumerate() {
        // Reconstruct full symmetric spectrum
        let mut full: Vec<Complex<f32>> = vec![Complex::new(0.0, 0.0); FFT_SIZE];
        for k in 0..half_spec.len() {
            full[k] = half_spec[k];
        }
        // Mirror conjugate for the negative-frequency half
        for k in 1..FFT_SIZE / 2 {
            full[FFT_SIZE - k] = full[k].conj();
        }
        inv_fft.process(&mut full);

        let pos = idx * HOP;
        for k in 0..FFT_SIZE {
            if pos + k >= output.len() {
                break;
            }
            let val = full[k].re / FFT_SIZE as f32;
            output[pos + k] += val * window[k];
            window_sum[pos + k] += window[k] * window[k];
        }
    }

    // Normalize by accumulated window^2
    for i in 0..output.len() {
        if window_sum[i] > 1e-9 {
            output[i] /= window_sum[i];
        }
    }
    output.truncate(output_len);
    output
}

/// Median filter along the TIME axis (each frequency bin separately).
fn median_time(mags: &[Vec<f32>], kernel: usize) -> Vec<Vec<f32>> {
    if mags.is_empty() {
        return vec![];
    }
    let num_freqs = mags[0].len();
    let half = kernel / 2;
    let mut out = vec![vec![0.0f32; num_freqs]; mags.len()];
    let mut buf: Vec<f32> = Vec::with_capacity(kernel);

    for f in 0..num_freqs {
        for t in 0..mags.len() {
            buf.clear();
            let lo = t.saturating_sub(half);
            let hi = (t + half + 1).min(mags.len());
            for tt in lo..hi {
                buf.push(mags[tt][f]);
            }
            out[t][f] = median(&mut buf);
        }
    }
    out
}

/// Median filter along the FREQUENCY axis (each time frame separately).
fn median_freq(mags: &[Vec<f32>], kernel: usize) -> Vec<Vec<f32>> {
    let half = kernel / 2;
    let mut out = Vec::with_capacity(mags.len());
    for frame in mags {
        let mut row = vec![0.0f32; frame.len()];
        let mut buf: Vec<f32> = Vec::with_capacity(kernel);
        for f in 0..frame.len() {
            buf.clear();
            let lo = f.saturating_sub(half);
            let hi = (f + half + 1).min(frame.len());
            for ff in lo..hi {
                buf.push(frame[ff]);
            }
            row[f] = median(&mut buf);
        }
        out.push(row);
    }
    out
}

fn median(values: &mut [f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    values.sort_by(|a, b| a.partial_cmp(b).unwrap());
    values[values.len() / 2]
}

/// Build a soft binary mask and apply to the complex spectrogram.
/// `keep_harmonic = true` keeps frames where harmonic > percussive, else inverse.
fn mask_complex(
    spec: &[Vec<Complex<f32>>],
    h_mags: &[Vec<f32>],
    p_mags: &[Vec<f32>],
    keep_harmonic: bool,
) -> Vec<Vec<Complex<f32>>> {
    spec.iter()
        .enumerate()
        .map(|(t, frame)| {
            frame
                .iter()
                .enumerate()
                .map(|(f, c)| {
                    let h = h_mags[t][f];
                    let p = p_mags[t][f];
                    let total = h + p + 1e-9;
                    // Soft Wiener-style mask
                    let m = if keep_harmonic { h * h / (h * h + p * p + 1e-9) } else { p * p / (h * h + p * p + 1e-9) };
                    let _ = total;
                    Complex::new(c.re * m, c.im * m)
                })
                .collect()
        })
        .collect()
}

//! Onset detection: RMS envelope (fast, monophonic-friendly) +
//! spectral flux (robust to continuous background, good for chord attacks).

use rustfft::{num_complex::Complex, FftPlanner};

/// Compute RMS envelope of audio by sliding window.
pub fn rms_envelope(samples: &[f32], hop: usize, window: usize) -> Vec<f32> {
    let mut env = Vec::with_capacity(samples.len() / hop);
    let mut i = 0;
    while i + window <= samples.len() {
        let mut sum_sq = 0.0f32;
        for &s in &samples[i..i + window] {
            sum_sq += s * s;
        }
        env.push((sum_sq / window as f32).sqrt());
        i += hop;
    }
    env
}

/// Spectral flux: per-frame sum of positive spectral-magnitude changes.
/// Captures attack events (new harmonic content) even when loudness is constant.
pub fn spectral_flux(samples: &[f32], sample_rate: u32) -> (Vec<f32>, usize) {
    let fft_size = 2048;
    let hop = 512; // ~11.6ms at 44.1kHz
    let _ = sample_rate; // hop is sample-count independent here

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);

    let mut prev_mag: Vec<f32> = vec![0.0; fft_size / 2];
    let mut flux: Vec<f32> = Vec::new();

    let mut i = 0;
    while i + fft_size <= samples.len() {
        // Hann-windowed FFT
        let mut buf: Vec<Complex<f32>> = (0..fft_size)
            .map(|k| {
                let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * k as f32 / (fft_size - 1) as f32).cos();
                Complex::new(samples[i + k] * w, 0.0)
            })
            .collect();
        fft.process(&mut buf);

        let mut sum = 0.0f32;
        for k in 0..fft_size / 2 {
            let mag = buf[k].norm();
            let diff = mag - prev_mag[k];
            if diff > 0.0 {
                sum += diff;
            }
            prev_mag[k] = mag;
        }
        flux.push(sum);
        i += hop;
    }

    (flux, hop)
}

/// Peak-pick a spectral-flux curve using an adaptive local-mean threshold.
pub fn detect_onsets_from_flux(
    flux: &[f32],
    hop_samples: usize,
    sample_rate: u32,
) -> Vec<usize> {
    if flux.len() < 8 {
        return vec![];
    }

    // Median-based normalization → robust to outliers
    let mut sorted = flux.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = sorted[sorted.len() / 2];
    let max = *sorted.last().unwrap();

    // Onset candidate must exceed local mean by this factor
    let factor = 1.6;
    let floor = (median * 2.0).max(max * 0.08);

    // Min spacing (50ms — allows fast strumming)
    let hop_ms = hop_samples as f32 * 1000.0 / sample_rate as f32;
    let min_frames = (50.0 / hop_ms).ceil() as usize;

    let mut onsets: Vec<usize> = Vec::new();
    let mut last_onset: i64 = -(min_frames as i64);

    let window = 20; // ~230ms local window for running mean
    for i in 3..flux.len() - 1 {
        if flux[i] < floor {
            continue;
        }

        // Local mean excluding current frame
        let start = i.saturating_sub(window);
        let local_sum: f32 = flux[start..i].iter().sum();
        let local_mean = local_sum / (i - start).max(1) as f32;

        if flux[i] < local_mean * factor {
            continue;
        }

        // Local max check
        if flux[i] < flux[i - 1] || flux[i] <= flux[i + 1] {
            continue;
        }

        if (i as i64) - last_onset < min_frames as i64 {
            continue;
        }

        onsets.push(i * hop_samples);
        last_onset = i as i64;
    }

    onsets
}

/// Detect note onset positions (in samples) by peak-picking the envelope derivative.
///
/// Strategy:
/// 1. Compute adaptive threshold from envelope statistics.
/// 2. Find frames where envelope rises sharply (positive derivative above threshold).
/// 3. Require local maximum in the envelope itself to filter bleed/fluctuations.
/// 4. Enforce minimum spacing between onsets (60ms) to prevent double-triggering.
pub fn detect_onsets(envelope: &[f32], hop_samples: usize, sample_rate: u32) -> Vec<usize> {
    if envelope.len() < 4 {
        return vec![];
    }

    let peak = envelope.iter().cloned().fold(0.0f32, f32::max);
    let mean = envelope.iter().sum::<f32>() / envelope.len() as f32;

    // Adaptive energy gate: notes must be louder than 10% of peak OR 2× mean
    let energy_gate = (peak * 0.10).max(mean * 1.5).max(0.003);

    // Derivative threshold: rise must exceed 8% of peak
    let rise_threshold = peak * 0.08;

    // Min spacing in envelope frames
    let hop_ms = hop_samples as f32 * 1000.0 / sample_rate as f32;
    let min_frames = (60.0 / hop_ms).ceil() as usize;

    let mut onsets: Vec<usize> = Vec::new();
    let mut last_onset_frame: i64 = -(min_frames as i64);

    // Look 2 frames back and 1 ahead to identify a rise
    for i in 2..envelope.len().saturating_sub(1) {
        // Must be above energy gate
        if envelope[i] < energy_gate {
            continue;
        }

        // Rise amount over 2 prior frames
        let rise = envelope[i] - envelope[i.saturating_sub(2)];
        if rise < rise_threshold {
            continue;
        }

        // Local max condition: higher than neighbors
        if envelope[i] < envelope[i - 1] || envelope[i] < envelope[i + 1] {
            continue;
        }

        // Spacing guard
        if (i as i64) - last_onset_frame < min_frames as i64 {
            continue;
        }

        // Push back a bit to capture actual attack start (approx. 1 frame before peak)
        let onset_sample = i.saturating_sub(1) * hop_samples;
        onsets.push(onset_sample);
        last_onset_frame = i as i64;
    }

    onsets
}

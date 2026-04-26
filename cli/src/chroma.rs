//! Chroma feature extraction and key/chord change detection.
//!
//! A "chroma vector" is a 12-dim vector summarizing how much energy is in each
//! pitch class (C, C#, D, ..., B), collapsing all octaves. Songs in different
//! keys produce different chroma profiles; a sudden drop in cosine similarity
//! between consecutive chroma frames means the key or chord progression shifted
//! — a strong indicator of a song boundary when other signals (onset, tempo)
//! miss it.

use rustfft::{num_complex::Complex, FftPlanner};

pub type Chroma = [f32; 12];

/// Compute a chroma feature per window across the audio.
///
/// Returns `(frames, hop_samples)`. Each frame is a 12-dim unit vector.
pub fn compute_chroma(samples: &[f32], sample_rate: u32) -> (Vec<Chroma>, usize) {
    let fft_size = 4096; // ~93ms at 44.1kHz
    let hop = 2048;

    let mut planner = FftPlanner::<f32>::new();
    let fft = planner.plan_fft_forward(fft_size);

    let freq_per_bin = sample_rate as f32 / fft_size as f32;
    let min_bin = (60.0 / freq_per_bin).ceil() as usize;
    let max_bin = ((2000.0 / freq_per_bin).floor() as usize).min(fft_size / 2 - 1);

    let mut frames: Vec<Chroma> = Vec::new();
    let mut i = 0;
    while i + fft_size <= samples.len() {
        let mut buf: Vec<Complex<f32>> = (0..fft_size)
            .map(|k| {
                let w = 0.5 - 0.5 * (2.0 * std::f32::consts::PI * k as f32 / (fft_size - 1) as f32).cos();
                Complex::new(samples[i + k] * w, 0.0)
            })
            .collect();
        fft.process(&mut buf);

        let mut chroma: Chroma = [0.0; 12];
        for k in min_bin..=max_bin {
            let freq = k as f32 * freq_per_bin;
            let midi = 12.0 * (freq / 440.0).log2() + 69.0;
            let pc = ((midi.round() as i32).rem_euclid(12)) as usize;
            chroma[pc] += buf[k].norm();
        }

        // Unit-normalize (so we compare shape, not loudness)
        let norm: f32 = chroma.iter().map(|v| v * v).sum::<f32>().sqrt();
        if norm > 1e-9 {
            for v in &mut chroma {
                *v /= norm;
            }
        }

        frames.push(chroma);
        i += hop;
    }

    (frames, hop)
}

/// Cosine similarity between two unit-normalized chroma vectors.
fn cosine_sim(a: &Chroma, b: &Chroma) -> f32 {
    let mut dot = 0.0f32;
    for i in 0..12 {
        dot += a[i] * b[i];
    }
    dot
}

/// Smooth a chroma sequence by averaging over a sliding window.
/// This suppresses transient chord changes inside a single song.
fn smoothed_frame(frames: &[Chroma], idx: usize, radius: usize) -> Chroma {
    let start = idx.saturating_sub(radius);
    let end = (idx + radius + 1).min(frames.len());
    let mut sum: Chroma = [0.0; 12];
    for f in &frames[start..end] {
        for k in 0..12 {
            sum[k] += f[k];
        }
    }
    let norm: f32 = sum.iter().map(|v| v * v).sum::<f32>().sqrt();
    if norm > 1e-9 {
        for v in &mut sum {
            *v /= norm;
        }
    }
    sum
}

/// Detect sample positions where the chroma profile shifts significantly,
/// suggesting a song/key change.
///
/// - `smooth_radius_frames`: number of frames to average on each side (e.g., 10 ≈ 1s)
/// - `compare_gap_frames`: how far apart to compare the two smoothed chromas
/// - `min_cos_drop`: similarity drop below this threshold is a boundary (e.g., 0.55)
/// - `min_boundary_gap_sec`: merge boundaries within this gap
pub fn detect_chroma_change_boundaries(
    frames: &[Chroma],
    hop_samples: usize,
    sample_rate: u32,
    smooth_radius_frames: usize,
    compare_gap_frames: usize,
    min_cos_drop: f32,
    min_boundary_gap_sec: f32,
) -> Vec<usize> {
    if frames.len() < 2 * compare_gap_frames + 4 {
        return vec![];
    }

    let min_gap_samples = (sample_rate as f32 * min_boundary_gap_sec) as usize;
    let mut boundaries: Vec<usize> = Vec::new();
    let mut last_b: Option<usize> = None;

    for i in compare_gap_frames..(frames.len() - compare_gap_frames) {
        let left = smoothed_frame(frames, i - compare_gap_frames, smooth_radius_frames);
        let right = smoothed_frame(frames, i + compare_gap_frames, smooth_radius_frames);
        let sim = cosine_sim(&left, &right);

        if sim < min_cos_drop {
            let sample = i * hop_samples;
            let ok = match last_b {
                Some(prev) => sample - prev >= min_gap_samples,
                None => true,
            };
            if ok {
                boundaries.push(sample);
                last_b = Some(sample);
            }
        }
    }

    boundaries
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(freq: f32, sample_rate: u32, duration_sec: f32) -> Vec<f32> {
        let n = (sample_rate as f32 * duration_sec) as usize;
        (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * freq * i as f32 / sample_rate as f32).sin())
            .collect()
    }

    #[test]
    fn chroma_peaks_at_correct_pitch_class() {
        // A4 = 440Hz → pitch class 9 (A)
        let samples = sine(440.0, 44100, 0.5);
        let (frames, _) = compute_chroma(&samples, 44100);
        assert!(!frames.is_empty());

        // The strongest bin in the chroma vector should be index 9 (A)
        for frame in &frames {
            let max_idx = frame
                .iter()
                .enumerate()
                .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
                .unwrap()
                .0;
            assert_eq!(max_idx, 9, "expected A (idx 9), got {} in {:?}", max_idx, frame);
        }
    }

    #[test]
    fn detects_key_change() {
        // Concatenate A4 (440Hz) followed by C5 (523Hz)
        let mut samples = sine(440.0, 44100, 2.0);
        samples.extend(sine(523.25, 44100, 2.0));

        let (frames, hop) = compute_chroma(&samples, 44100);

        // Sanity: pre- and post-transition chroma should differ heavily
        let pre = smoothed_frame(&frames, 20, 3);
        let post = smoothed_frame(&frames, 60, 3);
        let sim = cosine_sim(&pre, &post);
        assert!(sim < 0.3, "expected pre/post chroma to be orthogonal, got sim {:.2}", sim);

        // Less-strict detection params: threshold up to 0.3 similarity (80% drop)
        let boundaries = detect_chroma_change_boundaries(&frames, hop, 44100, 3, 5, 0.5, 0.5);
        assert!(
            !boundaries.is_empty(),
            "expected at least one key-change boundary (pre/post sim = {:.2})",
            sim
        );

        // Boundary should be near the 2-second mark
        let boundary_sec = boundaries[0] as f32 / 44100.0;
        assert!(
            (boundary_sec - 2.0).abs() < 1.0,
            "expected boundary near 2.0s, got {:.2}s",
            boundary_sec
        );
    }
}

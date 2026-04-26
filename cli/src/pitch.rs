//! YIN pitch detection algorithm
//! Reference: "YIN, a fundamental frequency estimator for speech and music"
//! de Cheveigné & Kawahara (2002)

/// Detect fundamental frequency in samples (default guitar range).
pub fn yin(samples: &[f32], sample_rate: u32) -> f32 {
    yin_with_range(samples, sample_rate, 70.0, 1500.0)
}

/// Detect fundamental frequency in samples for a specified frequency range.
/// Bass needs ~30Hz min, guitar needs ~70Hz min.
pub fn yin_with_range(samples: &[f32], sample_rate: u32, min_freq: f32, max_freq: f32) -> f32 {
    // Two-tier threshold: prefer strict, fall back to relaxed if nothing crosses it.
    const STRICT_THRESHOLD: f32 = 0.15;
    const FALLBACK_THRESHOLD: f32 = 0.5;

    let min_tau = (sample_rate as f32 / max_freq) as usize;
    let max_tau = (sample_rate as f32 / min_freq) as usize;
    let max_tau = max_tau.min(samples.len() / 2);

    if max_tau <= min_tau + 2 {
        return 0.0;
    }

    // Step 1: Difference function
    let mut d = vec![0.0f32; max_tau + 1];
    for tau in 1..=max_tau {
        let mut sum = 0.0f32;
        let end = samples.len() - tau;
        for j in 0..end {
            let diff = samples[j] - samples[j + tau];
            sum += diff * diff;
        }
        d[tau] = sum;
    }

    // Step 2: Cumulative mean normalized difference
    let mut cmnd = vec![1.0f32; max_tau + 1];
    let mut running_sum = 0.0f32;
    for tau in 1..=max_tau {
        running_sum += d[tau];
        if running_sum > 0.0 {
            cmnd[tau] = d[tau] * tau as f32 / running_sum;
        }
    }

    // Step 3: Find best tau.
    // Preferred: first local minimum under STRICT_THRESHOLD.
    // Fallback: global minimum under FALLBACK_THRESHOLD.
    let mut selected: Option<usize> = None;
    let mut tau = min_tau;
    while tau < max_tau {
        if cmnd[tau] < STRICT_THRESHOLD {
            while tau + 1 < max_tau && cmnd[tau + 1] < cmnd[tau] {
                tau += 1;
            }
            selected = Some(tau);
            break;
        }
        tau += 1;
    }

    let selected = selected.or_else(|| {
        let mut min_idx = min_tau;
        let mut min_val = cmnd[min_tau];
        for t in (min_tau + 1)..max_tau {
            if cmnd[t] < min_val {
                min_val = cmnd[t];
                min_idx = t;
            }
        }
        if min_val < FALLBACK_THRESHOLD {
            Some(min_idx)
        } else {
            None
        }
    });

    let Some(tau) = selected else { return 0.0 };

    // Step 4: Parabolic interpolation
    let better_tau = if tau > min_tau && tau < max_tau {
        parabolic_interp(cmnd[tau - 1], cmnd[tau], cmnd[tau + 1], tau)
    } else {
        tau as f32
    };

    if better_tau > 0.0 {
        sample_rate as f32 / better_tau
    } else {
        0.0
    }
}

fn parabolic_interp(y0: f32, y1: f32, y2: f32, x: usize) -> f32 {
    let denom = 2.0 * (2.0 * y1 - y0 - y2);
    if denom.abs() < 1e-9 {
        return x as f32;
    }
    x as f32 + (y2 - y0) / denom
}

/// Pitch stability check — does this onset look TONAL (a note) or PERCUSSIVE (a drum hit)?
///
/// Real notes hold a stable fundamental for at least ~150ms. Drum hits produce
/// either no detectable pitch, or a frequency that wanders wildly across windows.
///
/// Returns the median frequency if stable, 0.0 otherwise.
pub fn stable_pitch(
    samples: &[f32],
    onset_idx: usize,
    sample_rate: u32,
    min_freq: f32,
    max_freq: f32,
) -> f32 {
    let win_samples = (sample_rate as f32 * 0.06) as usize; // 60ms
    let lookahead_offsets_ms = [40.0, 80.0, 120.0, 160.0];

    let mut detected: Vec<f32> = Vec::new();
    for off_ms in &lookahead_offsets_ms {
        let start = onset_idx + (sample_rate as f32 * off_ms / 1000.0) as usize;
        let end = (start + win_samples).min(samples.len());
        if end <= start + 200 {
            continue;
        }
        let f = yin_with_range(&samples[start..end], sample_rate, min_freq, max_freq);
        if f >= min_freq && f <= max_freq {
            detected.push(f);
        }
    }

    if detected.len() < 2 {
        return 0.0;
    }

    // Use median as the canonical pitch
    detected.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = detected[detected.len() / 2];

    // Check stability: at least half the samples within ±50 cents (semitone-quarter) of median
    let close = detected
        .iter()
        .filter(|f| 1200.0 * (*f / median).log2().abs() < 50.0)
        .count();
    if close * 2 < detected.len() {
        return 0.0;
    }

    median
}

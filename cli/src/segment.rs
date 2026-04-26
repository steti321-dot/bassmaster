//! Audio segmentation: split a long audio file into distinct song segments.
//!
//! Three strategies, in order of reliability:
//! 1. External chapter list (YouTube chapters, user-provided) — ground truth
//! 2. Onset-gap detection — good for music with pauses between pieces
//! 3. Silence-gap detection — works only if actual silences exist
//!
//! Strategy: find contiguous runs of near-silence (RMS below adaptive threshold)
//! that last at least `min_gap_ms`. These gaps mark song boundaries. Everything
//! between them (and above a minimum duration) is a segment.

/// Detected audio segment, in sample indices.
#[derive(Debug, Clone)]
pub struct Segment {
    pub start: usize,
    pub end: usize,
    pub label: Option<String>,
}

impl Segment {
    pub fn duration_sec(&self, sample_rate: u32) -> f32 {
        (self.end - self.start) as f32 / sample_rate as f32
    }
}

/// Split audio into song segments using silence gaps.
///
/// Params:
/// - `envelope`: RMS envelope frames (from onset::rms_envelope)
/// - `hop_samples`: hop size used to compute the envelope
/// - `sample_rate`: audio sample rate
/// - `min_gap_ms`: minimum silence duration to count as a song boundary
/// - `min_segment_ms`: minimum segment duration to keep (filters blips)
pub fn split_by_silence(
    envelope: &[f32],
    hop_samples: usize,
    sample_rate: u32,
    min_gap_ms: u32,
    min_segment_ms: u32,
) -> Vec<Segment> {
    if envelope.is_empty() {
        return vec![];
    }

    // Adaptive silence threshold: 12% of median energy, bounded below
    let mut sorted = envelope.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = sorted[sorted.len() / 2];
    let silence_threshold = (median * 0.15).max(0.005);

    let hop_ms = hop_samples as f32 * 1000.0 / sample_rate as f32;
    let min_gap_frames = (min_gap_ms as f32 / hop_ms).ceil() as usize;

    // Mark each frame as silent or active
    let is_silent: Vec<bool> = envelope.iter().map(|&e| e < silence_threshold).collect();

    let mut segments: Vec<Segment> = Vec::new();
    let mut seg_start: Option<usize> = None;
    let mut silence_run: usize = 0;

    for (i, &silent) in is_silent.iter().enumerate() {
        if silent {
            silence_run += 1;
            // If silence just exceeded the minimum gap, close the current segment
            if silence_run == min_gap_frames {
                if let Some(start) = seg_start.take() {
                    let end_frame = i - min_gap_frames;
                    segments.push(Segment {
                        start: start * hop_samples,
                        end: end_frame * hop_samples,
                        label: None,
                    });
                }
            }
        } else {
            silence_run = 0;
            if seg_start.is_none() {
                seg_start = Some(i);
            }
        }
    }

    // Close any trailing segment
    if let Some(start) = seg_start {
        segments.push(Segment {
            start: start * hop_samples,
            end: envelope.len() * hop_samples,
            label: None,
        });
    }

    // Filter short blips
    let min_segment_samples = (sample_rate as u64 * min_segment_ms as u64 / 1000) as usize;
    segments.retain(|s| s.end - s.start >= min_segment_samples);

    segments
}

/// Split audio into segments by finding gaps in the onset stream.
///
/// Works better than pure RMS for audio where "silence" contains speech,
/// because tutorial narration has sparse/irregular onsets while musical phrases
/// have dense, regular onsets.
///
/// A gap of `min_gap_sec` between consecutive onsets marks a segment boundary.
pub fn split_by_onset_gaps(
    onsets: &[usize],
    sample_rate: u32,
    min_gap_sec: f32,
    min_segment_sec: f32,
    total_samples: usize,
) -> Vec<Segment> {
    if onsets.is_empty() {
        return vec![];
    }

    let min_gap_samples = (sample_rate as f32 * min_gap_sec) as usize;
    let min_segment_samples = (sample_rate as f32 * min_segment_sec) as usize;
    let tail_pad = (sample_rate as f32 * 0.5) as usize;

    let mut segments: Vec<Segment> = Vec::new();
    let mut seg_start = onsets[0];
    let mut last_onset = onsets[0];

    for &o in &onsets[1..] {
        if o.saturating_sub(last_onset) > min_gap_samples {
            segments.push(Segment {
                start: seg_start,
                end: (last_onset + tail_pad).min(total_samples),
                label: None,
            });
            seg_start = o;
        }
        last_onset = o;
    }
    segments.push(Segment {
        start: seg_start,
        end: (last_onset + tail_pad).min(total_samples),
        label: None,
    });

    segments.retain(|s| s.end - s.start >= min_segment_samples);
    segments
}

/// Estimate local tempo (BPM) from onsets within a time window.
/// Uses median inter-onset interval — fast and reasonably stable when the
/// window contains ≥ 4 onsets.
fn local_tempo_bpm(onsets_in_window: &[usize], sample_rate: u32) -> Option<f32> {
    if onsets_in_window.len() < 4 {
        return None;
    }
    let mut intervals_ms: Vec<f32> = onsets_in_window
        .windows(2)
        .map(|w| (w[1] - w[0]) as f32 * 1000.0 / sample_rate as f32)
        .filter(|&i| i > 80.0 && i < 2000.0)
        .collect();
    if intervals_ms.len() < 3 {
        return None;
    }
    intervals_ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let median = intervals_ms[intervals_ms.len() / 2];
    Some(60000.0 / median)
}

/// Find sample positions where local tempo shifts significantly.
/// Returns sample indices (boundary candidates).
pub fn detect_tempo_change_boundaries(
    onsets: &[usize],
    sample_rate: u32,
    window_sec: f32,
    hop_sec: f32,
    min_change_ratio: f32,
) -> Vec<usize> {
    if onsets.len() < 8 {
        return vec![];
    }

    let window_samples = (sample_rate as f32 * window_sec) as usize;
    let hop_samples = (sample_rate as f32 * hop_sec) as usize;
    let total_samples = *onsets.last().unwrap();

    // Sliding-window tempo estimates: (window_start_sample, bpm)
    let mut tempos: Vec<(usize, f32)> = Vec::new();
    let mut win_start = 0usize;
    while win_start + window_samples <= total_samples {
        let win_end = win_start + window_samples;
        let in_win: Vec<usize> = onsets
            .iter()
            .copied()
            .filter(|&o| o >= win_start && o < win_end)
            .collect();
        if let Some(bpm) = local_tempo_bpm(&in_win, sample_rate) {
            tempos.push((win_start, bpm));
        }
        win_start += hop_samples;
    }

    // Scan for tempo changes between consecutive windows
    let mut boundaries: Vec<usize> = Vec::new();
    for pair in tempos.windows(2) {
        let (_, bpm_a) = pair[0];
        let (start_b, bpm_b) = pair[1];
        let ratio = (bpm_b - bpm_a).abs() / bpm_a.max(bpm_b);
        if ratio > min_change_ratio {
            boundaries.push(start_b);
        }
    }

    // Collapse boundaries that are within one hop of each other
    let mut dedup: Vec<usize> = Vec::new();
    let dedup_gap = hop_samples;
    for b in boundaries {
        if dedup.last().map_or(true, |&prev| b.saturating_sub(prev) > dedup_gap) {
            dedup.push(b);
        }
    }
    dedup
}

/// Combine onset-gap detection and tempo-change detection into one segmentation.
/// Union of boundary candidates, then converted to segments.
pub fn split_by_onset_gaps_and_tempo(
    onsets: &[usize],
    sample_rate: u32,
    gap_sec: f32,
    min_segment_sec: f32,
    tempo_window_sec: f32,
    tempo_hop_sec: f32,
    tempo_change_ratio: f32,
    total_samples: usize,
) -> Vec<Segment> {
    if onsets.is_empty() {
        return vec![];
    }

    // Start set of boundaries: the first onset, plus gap-detected and tempo-change boundaries
    let mut boundaries: Vec<usize> = vec![onsets[0]];

    let min_gap_samples = (sample_rate as f32 * gap_sec) as usize;
    for w in onsets.windows(2) {
        if w[1].saturating_sub(w[0]) > min_gap_samples {
            boundaries.push(w[1]);
        }
    }

    let tempo_boundaries = detect_tempo_change_boundaries(
        onsets,
        sample_rate,
        tempo_window_sec,
        tempo_hop_sec,
        tempo_change_ratio,
    );
    boundaries.extend(tempo_boundaries);

    boundaries.sort();
    boundaries.dedup();

    // Collapse boundaries that are too close together (within 4s)
    let merge_gap = (sample_rate as f32 * 4.0) as usize;
    let mut merged: Vec<usize> = Vec::new();
    for b in boundaries {
        if merged.last().map_or(true, |&prev| b.saturating_sub(prev) > merge_gap) {
            merged.push(b);
        }
    }

    // Convert boundaries to segments
    let min_segment_samples = (sample_rate as f32 * min_segment_sec) as usize;
    let tail_pad = (sample_rate as f32 * 0.5) as usize;
    let mut segments: Vec<Segment> = Vec::new();
    for i in 0..merged.len() {
        let start = merged[i];
        let end = if i + 1 < merged.len() {
            merged[i + 1]
        } else {
            total_samples
        };
        let seg_end = (end + tail_pad).min(total_samples);
        if seg_end.saturating_sub(start) >= min_segment_samples {
            segments.push(Segment {
                start,
                end: seg_end,
                label: None,
            });
        }
    }
    segments
}

/// Combine three boundary signals: onset gaps, tempo change, and chroma change.
/// Boundaries within 4s of each other are merged (taking the earlier).
pub fn split_combined(
    onsets: &[usize],
    chroma_boundaries: &[usize],
    sample_rate: u32,
    gap_sec: f32,
    min_segment_sec: f32,
    tempo_window_sec: f32,
    tempo_hop_sec: f32,
    tempo_change_ratio: f32,
    total_samples: usize,
) -> Vec<Segment> {
    if onsets.is_empty() {
        return vec![];
    }

    let mut boundaries: Vec<usize> = vec![onsets[0]];

    // Onset-gap boundaries
    let min_gap_samples = (sample_rate as f32 * gap_sec) as usize;
    for w in onsets.windows(2) {
        if w[1].saturating_sub(w[0]) > min_gap_samples {
            boundaries.push(w[1]);
        }
    }

    // Tempo-change boundaries
    let tempo_boundaries = detect_tempo_change_boundaries(
        onsets,
        sample_rate,
        tempo_window_sec,
        tempo_hop_sec,
        tempo_change_ratio,
    );
    boundaries.extend(tempo_boundaries);

    // Chroma-change boundaries
    boundaries.extend(chroma_boundaries.iter().copied());

    boundaries.sort();
    boundaries.dedup();

    // Merge boundaries within 4s
    let merge_gap = (sample_rate as f32 * 4.0) as usize;
    let mut merged: Vec<usize> = Vec::new();
    for b in boundaries {
        if merged.last().map_or(true, |&prev| b.saturating_sub(prev) > merge_gap) {
            merged.push(b);
        }
    }

    // Convert to segments
    let min_segment_samples = (sample_rate as f32 * min_segment_sec) as usize;
    let tail_pad = (sample_rate as f32 * 0.5) as usize;
    let mut segments: Vec<Segment> = Vec::new();
    for i in 0..merged.len() {
        let start = merged[i];
        let end = if i + 1 < merged.len() {
            merged[i + 1]
        } else {
            total_samples
        };
        let seg_end = (end + tail_pad).min(total_samples);
        if seg_end.saturating_sub(start) >= min_segment_samples {
            segments.push(Segment {
                start,
                end: seg_end,
                label: None,
            });
        }
    }
    segments
}

/// Build segments from an explicit list of (start_sec, label) pairs.
/// End of each segment is the start of the next, or total_samples for the last.
pub fn from_chapters(
    chapters: &[(f32, String)],
    sample_rate: u32,
    total_samples: usize,
) -> Vec<Segment> {
    if chapters.is_empty() {
        return vec![];
    }
    let mut out = Vec::with_capacity(chapters.len());
    for (i, (start_sec, label)) in chapters.iter().enumerate() {
        let start = (start_sec * sample_rate as f32) as usize;
        let end = if i + 1 < chapters.len() {
            (chapters[i + 1].0 * sample_rate as f32) as usize
        } else {
            total_samples
        };
        if end > start {
            out.push(Segment {
                start,
                end: end.min(total_samples),
                label: Some(label.clone()),
            });
        }
    }
    out
}

/// Parse a simple chapters file:
///   123.5 Song Title
///   456.0 Another Song
/// Blank lines and lines starting with `#` are ignored.
pub fn parse_chapters_file(text: &str) -> Vec<(f32, String)> {
    let mut out = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((ts_str, label)) = line.split_once(char::is_whitespace) {
            if let Ok(ts) = ts_str.parse::<f32>() {
                out.push((ts, label.trim().to_string()));
            }
        }
    }
    out
}

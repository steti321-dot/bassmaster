//! CLI: audio file → GP4 transcription
//! Usage: transcribe <input.m4a|mp3|wav> <output.gp4>

use std::env;
use std::fs::File;
use std::path::Path;
use std::process::exit;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

mod pitch;
mod gp4;
mod onset;
mod polyphonic;
mod segment;
mod chroma;
mod wav;
mod ai;
mod instrument;
mod hpss;

use instrument::Instrument;

#[derive(Debug, Clone)]
pub struct Note {
    pub fret: u8,
    pub string: u8,
    pub time_ms: f32,
    pub duration_ms: f32,
    pub frequency: f32,
}

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 3 {
        eprintln!("Usage: transcribe <input_audio> <output.gp4> [--ai | --chords] [--bass] [--clean] [--segments]");
        eprintln!("  --ai        Use Spotify's Basic Pitch neural net (requires Node + npm install)");
        eprintln!("  --chords    Enable FFT polyphonic detection (no AI)");
        eprintln!("  --bass      4-string bass tuning + lower frequency range");
        eprintln!("  --clean     HPSS preprocessing — suppresses drums/percussive content");
        eprintln!("  --segments  Split multi-song audio; writes output-01.gp4, output-02.gp4, ...");
        exit(1);
    }

    let input_path = &args[1];
    let output_path = &args[2];
    let polyphonic = args.iter().any(|a| a == "--chords");
    let segments_mode = args.iter().any(|a| a == "--segments");
    let use_ai = args.iter().any(|a| a == "--ai");
    let instrument = if args.iter().any(|a| a == "--bass") {
        Instrument::Bass
    } else {
        Instrument::Guitar
    };
    let clean_drums = args.iter().any(|a| a == "--clean");
    let json_out: Option<String> = args
        .windows(2)
        .find(|w| w[0] == "--json")
        .map(|w| w[1].clone());
    let chapters_file: Option<String> = args
        .windows(2)
        .find(|w| w[0] == "--chapters")
        .map(|w| w[1].clone());

    println!(
        "🎸 Transcribing {} → {} [{}{}]",
        input_path,
        output_path,
        if polyphonic { "polyphonic" } else { "monophonic" },
        if segments_mode { ", segmented" } else { "" }
    );

    let (mut samples, sample_rate) = match decode_audio(input_path) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("✗ Audio decode failed: {}", e);
            exit(1);
        }
    };

    println!(
        "✓ Decoded {} samples at {} Hz ({:.2}s)",
        samples.len(),
        sample_rate,
        samples.len() as f32 / sample_rate as f32
    );

    if clean_drums {
        println!("✓ Running HPSS to suppress percussive content...");
        let started = std::time::Instant::now();
        let (harmonic, _percussive) = hpss::separate(&samples, sample_rate);
        samples = harmonic;
        println!("  HPSS done in {:.2}s", started.elapsed().as_secs_f32());
    }

    // Compute RMS envelope (used by onset + segmentation)
    let env_hop_ms = 5.0;
    let env_hop = (sample_rate as f32 * env_hop_ms / 1000.0) as usize;
    let env_window = env_hop * 4;
    let envelope = onset::rms_envelope(&samples, env_hop, env_window);
    let peak_rms = envelope.iter().cloned().fold(0.0f32, f32::max);
    let mean_rms = envelope.iter().sum::<f32>() / envelope.len() as f32;
    println!(
        "✓ RMS envelope: {} frames (peak={:.4}, mean={:.4})",
        envelope.len(),
        peak_rms,
        mean_rms
    );

    if segments_mode || chapters_file.is_some() {
        let segments = if let Some(path) = &chapters_file {
            let text = std::fs::read_to_string(path).unwrap_or_else(|e| {
                eprintln!("✗ Cannot read chapters file {}: {}", path, e);
                exit(1);
            });
            let chapters = segment::parse_chapters_file(&text);
            println!("✓ Loaded {} chapters from {}", chapters.len(), path);
            segment::from_chapters(&chapters, sample_rate, samples.len())
        } else {
            let (flux, flux_hop) = onset::spectral_flux(&samples, sample_rate);
            let full_onsets = onset::detect_onsets_from_flux(&flux, flux_hop, sample_rate);
            println!("✓ {} total onsets across full file", full_onsets.len());

            // Chroma-based key/chord change detection
            let (chroma_frames, chroma_hop) = chroma::compute_chroma(&samples, sample_rate);
            let chroma_boundaries = chroma::detect_chroma_change_boundaries(
                &chroma_frames,
                chroma_hop,
                sample_rate,
                15,   // smooth_radius_frames (~0.7s) — wider smoothing reduces intra-song sensitivity
                25,   // compare_gap_frames (~1.2s)
                0.50, // min_cos_drop — only fire when chroma is very different (real key change)
                8.0,  // min_boundary_gap_sec — songs are always at least 8s in tutorials
            );
            println!("✓ {} chroma-change boundary candidate(s)", chroma_boundaries.len());

            let segs = segment::split_combined(
                &full_onsets,
                &chroma_boundaries,
                sample_rate,
                2.5,   // gap_sec
                3.0,   // min_segment_sec
                8.0,   // tempo_window_sec
                2.0,   // tempo_hop_sec
                0.18,  // tempo_change_ratio
                samples.len(),
            );
            println!("✓ Detected {} segment(s) via onset+tempo+chroma", segs.len());
            segs
        };

        if segments.is_empty() {
            eprintln!("✗ No segments found. Try without --segments.");
            exit(1);
        }

        let out_base = output_path.trim_end_matches(".gp4").to_string();

        for (i, seg) in segments.iter().enumerate() {
            let seg_num = i + 1;
            let out_file = format!("{}-{:02}.gp4", out_base, seg_num);
            let duration = seg.duration_sec(sample_rate);
            let label_text = seg.label.as_deref().unwrap_or("(unlabeled)");
            println!(
                "\n--- Segment {}/{}: {:.2}s - {:.2}s ({:.2}s) \"{}\" → {}",
                seg_num,
                segments.len(),
                seg.start as f32 / sample_rate as f32,
                seg.end as f32 / sample_rate as f32,
                duration,
                label_text,
                out_file
            );

            let seg_samples = &samples[seg.start..seg.end];
            let title = seg.label.clone().unwrap_or_else(|| format!("Segment {}", seg_num));
            let _ = process_and_write_named(
                seg_samples,
                sample_rate,
                polyphonic,
                use_ai,
                instrument,
                &out_file,
                &title,
            );
        }

        println!(
            "\n✅ Wrote {} segment file(s) with prefix '{}'",
            segments.len(),
            out_base
        );
    } else {
        let (notes, tempo) = process_and_write_named(
            &samples,
            sample_rate,
            polyphonic,
            use_ai,
            instrument,
            output_path,
            "Transcription",
        );

        if let Some(json_path) = json_out {
            write_notes_json(&json_path, &notes, tempo, output_path, input_path, instrument);
            println!("  wrote notes JSON to {}", json_path);
        }
    }
}

fn write_notes_json(
    path: &str,
    notes: &[Note],
    tempo: u32,
    gp4_path: &str,
    source_path: &str,
    instrument: Instrument,
) {
    let string_names_guitar = ["hi E", "B", "G", "D", "A", "lo E"];
    let string_names_bass = ["G", "D", "A", "E"];
    let string_names: &[&str] = match instrument {
        Instrument::Guitar => &string_names_guitar,
        Instrument::Bass => &string_names_bass,
    };
    let instrument_str = match instrument {
        Instrument::Guitar => "guitar",
        Instrument::Bass => "bass",
    };
    let mut json = String::new();
    json.push_str("{\n");
    json.push_str(&format!("  \"sourceFile\": \"{}\",\n", json_escape(source_path)));
    json.push_str(&format!("  \"gp4File\": \"{}\",\n", json_escape(gp4_path)));
    json.push_str(&format!("  \"tempo\": {},\n", tempo));
    json.push_str(&format!("  \"instrument\": \"{}\",\n", instrument_str));
    json.push_str("  \"timeSignature\": { \"numerator\": 4, \"denominator\": 4 },\n");
    json.push_str(&format!("  \"noteCount\": {},\n", notes.len()));
    json.push_str("  \"notes\": [\n");
    for (i, n) in notes.iter().enumerate() {
        let comma = if i + 1 == notes.len() { "" } else { "," };
        json.push_str(&format!(
            "    {{ \"fret\": {}, \"string\": {}, \"stringName\": \"{}\", \"time\": {:.3}, \"duration\": {:.3}, \"frequency\": {:.2} }}{}\n",
            n.fret,
            n.string,
            string_names[n.string as usize],
            n.time_ms,
            n.duration_ms,
            n.frequency,
            comma
        ));
    }
    json.push_str("  ]\n}");
    std::fs::write(path, json).unwrap();
}

fn json_escape(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

fn process_and_write_named(
    samples: &[f32],
    sample_rate: u32,
    polyphonic: bool,
    use_ai: bool,
    instrument: Instrument,
    output_path: &str,
    title: &str,
) -> (Vec<Note>, u32) {
    // Onsets
    let (flux, flux_hop) = onset::spectral_flux(samples, sample_rate);
    let mut onsets = onset::detect_onsets_from_flux(&flux, flux_hop, sample_rate);

    if onsets.len() < 2 {
        let env_hop = (sample_rate as f32 * 0.005) as usize;
        let env_window = env_hop * 4;
        let env = onset::rms_envelope(samples, env_hop, env_window);
        onsets = onset::detect_onsets(&env, env_hop, sample_rate);
    }
    println!("  {} onsets", onsets.len());

    let notes = if use_ai {
        match transcribe_with_ai(samples, sample_rate, instrument) {
            Ok(n) => n,
            Err(e) => {
                eprintln!("  [ai] FAILED: {}", e);
                eprintln!("  [ai] falling back to FFT polyphonic");
                transcribe_polyphonic(samples, sample_rate, &onsets, instrument)
            }
        }
    } else if polyphonic {
        transcribe_polyphonic(samples, sample_rate, &onsets, instrument)
    } else {
        transcribe_at_onsets(samples, sample_rate, &onsets, instrument)
    };
    println!("  {} notes", notes.len());

    let tempo = estimate_tempo(&notes);
    println!("  tempo: {} BPM", tempo);

    let gp4_bytes = gp4::write_gp4(&notes, tempo, title, "MP3 to GP4", instrument);
    std::fs::write(output_path, &gp4_bytes).unwrap();
    println!("  wrote {} bytes to {}", gp4_bytes.len(), output_path);

    (notes, tempo)
}

fn transcribe_at_onsets(samples: &[f32], sample_rate: u32, onsets: &[usize], instrument: Instrument) -> Vec<Note> {
    let mut notes = Vec::new();
    // Bass needs a longer window because periods are longer (low E1 ≈ 24ms / cycle).
    let window_secs = match instrument {
        Instrument::Bass => 0.4,
        Instrument::Guitar => 0.2,
    };
    let pitch_window = (sample_rate as f32 * window_secs) as usize;
    let min_freq = instrument.min_pitch_hz();
    let max_freq = instrument.max_pitch_hz();

    let mut rejected_percussive = 0;
    for (i, &onset_sample) in onsets.iter().enumerate() {
        // Percussive rejection: a real note holds its pitch for ~150ms; drums don't.
        // stable_pitch returns 0 if the pitch is unstable across multiple windows.
        let stable = pitch::stable_pitch(samples, onset_sample, sample_rate, min_freq, max_freq);
        if stable <= 0.0 {
            rejected_percussive += 1;
            continue;
        }

        // Re-confirm with a longer single-window read for higher precision
        let offsets_ms = [30.0, 60.0, 100.0, 15.0];
        let mut best_freq = stable;
        for off_ms in &offsets_ms {
            let analysis_start = onset_sample + (sample_rate as f32 * off_ms / 1000.0) as usize;
            let analysis_end = (analysis_start + pitch_window).min(samples.len());
            if analysis_end <= analysis_start + 1000 {
                continue;
            }
            let chunk = &samples[analysis_start..analysis_end];
            let freq = pitch::yin_with_range(chunk, sample_rate, min_freq, max_freq);
            if freq >= min_freq && freq <= max_freq && (freq - stable).abs() / stable < 0.06 {
                best_freq = freq;
                break;
            }
        }

        let time_ms = (onset_sample as f32 / sample_rate as f32) * 1000.0;
        let next_onset_ms = if i + 1 < onsets.len() {
            (onsets[i + 1] as f32 / sample_rate as f32) * 1000.0
        } else {
            (samples.len() as f32 / sample_rate as f32) * 1000.0
        };
        let duration_ms = (next_onset_ms - time_ms).min(2000.0).max(50.0);

        let prev = notes.last();
        let Some((string, fret)) = choose_position(best_freq, prev, instrument) else {
            continue;
        };

        notes.push(Note {
            fret,
            string,
            time_ms,
            duration_ms,
            frequency: best_freq,
        });
    }

    if rejected_percussive > 0 {
        eprintln!(
            "  rejected {} percussive/unstable onset(s)",
            rejected_percussive
        );
    }

    notes
}

fn decode_audio(path: &str) -> Result<(Vec<f32>, u32), String> {
    let file = File::open(path).map_err(|e| format!("open {}: {}", path, e))?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = Path::new(path).extension().and_then(|s| s.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("probe: {}", e))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("no default track")?.clone();
    let track_id = track.id;
    let sample_rate = track.codec_params.sample_rate.ok_or("unknown sample rate")?;

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| format!("decoder: {}", e))?;

    let mut samples: Vec<f32> = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;
    let mut channels: usize = 0;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(e)) if e.kind() == std::io::ErrorKind::UnexpectedEof => break,
            Err(SymphoniaError::ResetRequired) => break,
            Err(e) => return Err(format!("packet: {}", e)),
        };
        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(decoded) => {
                if sample_buf.is_none() {
                    let spec = *decoded.spec();
                    channels = spec.channels.count();
                    sample_buf = Some(SampleBuffer::<f32>::new(decoded.capacity() as u64, spec));
                }
                let sb = sample_buf.as_mut().unwrap();
                sb.copy_interleaved_ref(decoded);

                if channels > 1 {
                    for chunk in sb.samples().chunks(channels) {
                        let sum: f32 = chunk.iter().sum();
                        samples.push(sum / channels as f32);
                    }
                } else {
                    samples.extend_from_slice(sb.samples());
                }
            }
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(format!("decode: {}", e)),
        }
    }

    if samples.is_empty() {
        return Err("no samples decoded (codec may be unsupported)".to_string());
    }

    Ok((samples, sample_rate))
}

fn transcribe_with_ai(samples: &[f32], sample_rate: u32, instrument: Instrument) -> Result<Vec<Note>, String> {
    let ai_notes = ai::transcribe_with_basic_pitch(samples, sample_rate)?;
    let mut notes = Vec::new();
    let mut rejected = 0;
    for a in &ai_notes {
        let freq = ai::midi_to_hz(a.pitch_midi);
        let prev = notes.last();
        if let Some((string, fret)) = choose_position(freq, prev, instrument) {
            notes.push(Note {
                fret,
                string,
                time_ms: a.start_sec * 1000.0,
                duration_ms: a.duration_sec * 1000.0,
                frequency: freq,
            });
        } else {
            rejected += 1;
        }
    }
    notes.sort_by(|a, b| a.time_ms.partial_cmp(&b.time_ms).unwrap());
    if rejected > 0 {
        eprintln!(
            "  [ai] rejected {} note(s) outside {} range ({:.0}-{:.0} Hz)",
            rejected,
            instrument.track_name(),
            instrument.min_pitch_hz(),
            instrument.max_pitch_hz()
        );
    }
    Ok(notes)
}

fn transcribe_polyphonic(
    samples: &[f32],
    sample_rate: u32,
    onsets: &[usize],
    instrument: Instrument,
) -> Vec<Note> {
    let mut notes = Vec::new();
    let window_samples = (sample_rate as f32 * 0.2) as usize;
    let max_chord_size = if instrument == Instrument::Bass { 3 } else { 6 };
    let mid_string = (instrument.string_count() as i32 - 1) / 2;

    for (i, &onset_sample) in onsets.iter().enumerate() {
        let start = onset_sample + (sample_rate as f32 * 0.03) as usize;
        let end = (start + window_samples).min(samples.len());
        if end <= start + 1000 {
            continue;
        }

        let peaks = polyphonic::detect_fundamentals(&samples[start..end], sample_rate, max_chord_size);
        if peaks.is_empty() {
            continue;
        }

        let time_ms = (onset_sample as f32 / sample_rate as f32) * 1000.0;
        let next_onset_ms = if i + 1 < onsets.len() {
            (onsets[i + 1] as f32 / sample_rate as f32) * 1000.0
        } else {
            (samples.len() as f32 / sample_rate as f32) * 1000.0
        };
        let duration_ms = (next_onset_ms - time_ms).min(2000.0).max(50.0);

        let mut used_strings = vec![false; instrument.string_count()];
        let mut peak_notes = Vec::new();
        for peak in &peaks {
            let candidates = playable_positions(peak.frequency, instrument);
            let Some((string, fret)) = candidates
                .into_iter()
                .filter(|(s, _)| !used_strings[*s as usize])
                .min_by_key(|(s, f)| (*f as i32 - 5).abs() + (*s as i32 - mid_string).abs())
            else { continue };

            used_strings[string as usize] = true;
            peak_notes.push(Note {
                fret,
                string,
                time_ms,
                duration_ms,
                frequency: peak.frequency,
            });
        }

        peak_notes.sort_by_key(|n| n.string);
        notes.extend(peak_notes);
    }

    notes
}

/// Enumerate all (string, fret) positions where `freq` can be played on a given instrument.
fn playable_positions(freq: f32, instr: Instrument) -> Vec<(u8, u8)> {
    if freq < instr.min_pitch_hz() || freq > instr.max_pitch_hz() || !freq.is_finite() {
        return vec![];
    }
    let mut out = Vec::new();
    for (s, &open) in instr.tunings_hz().iter().enumerate() {
        let fret = (12.0 * (freq / open).log2()).round() as i32;
        if (0..=instr.fret_count() as i32).contains(&fret) {
            let actual = open * 2.0f32.powf(fret as f32 / 12.0);
            let cents = 1200.0 * (freq / actual).log2().abs();
            if cents < 50.0 {
                out.push((s as u8, fret as u8));
            }
        }
    }
    out
}

/// Pick (string, fret) minimizing hand movement from previous note.
fn choose_position(freq: f32, prev: Option<&Note>, instr: Instrument) -> Option<(u8, u8)> {
    let candidates = playable_positions(freq, instr);
    if candidates.is_empty() {
        return None;
    }
    let mid_string = (instr.string_count() as f32 - 1.0) / 2.0;
    candidates
        .into_iter()
        .map(|(s, f)| (s, f, score_position(s, f, prev, mid_string)))
        .min_by(|a, b| a.2.partial_cmp(&b.2).unwrap())
        .map(|(s, f, _)| (s, f))
}

fn score_position(string: u8, fret: u8, prev: Option<&Note>, mid_string: f32) -> f32 {
    let mut cost = (fret as f32 - 5.0).abs() * 0.3;
    cost += (string as f32 - mid_string).abs() * 0.05;

    if let Some(p) = prev {
        cost += (string as i32 - p.string as i32).abs() as f32 * 2.5;
        cost += (fret as i32 - p.fret as i32).abs() as f32 * 1.0;
    }

    cost
}

/// Estimate song tempo in BPM using inter-onset intervals.
///
/// Approach:
/// 1. Build a histogram of intervals (filtered to a musical range)
/// 2. Pick the dominant interval (mode, not median — robust to outliers)
/// 3. The raw BPM is often off by an "octave" (2× or 4× too fast) because
///    the dominant interval is typically the 8th-note or 16th-note period,
///    not the beat period. Map to the musical range 60-180 by halving/doubling.
fn estimate_tempo(notes: &[Note]) -> u32 {
    if notes.len() < 4 {
        return 120;
    }

    let intervals: Vec<f32> = notes
        .windows(2)
        .map(|w| w[1].time_ms - w[0].time_ms)
        .filter(|&i| i > 80.0 && i < 2000.0)
        .collect();

    if intervals.len() < 3 {
        return 120;
    }

    // Histogram with 15ms bins
    let bin_ms = 15.0;
    let num_bins = (2000.0 / bin_ms) as usize + 1;
    let mut hist = vec![0u32; num_bins];
    for &iv in &intervals {
        let bin = (iv / bin_ms) as usize;
        if bin < num_bins {
            hist[bin] += 1;
        }
    }

    // Find dominant bin (mode), smoothed with a 3-bin window to avoid single-bin spikes
    let (peak_bin, _) = (1..num_bins - 1)
        .map(|i| (i, hist[i - 1] + hist[i] + hist[i + 1]))
        .max_by_key(|&(_, c)| c)
        .unwrap_or((0, 0));

    let peak_interval = (peak_bin as f32 + 0.5) * bin_ms;
    let raw_bpm = 60000.0 / peak_interval;

    // Octave resolution: score each candidate BPM by how many observed intervals
    // align with its beat grid at integer ratios (1/4, 1/2, 1, 2, 3, 4).
    // Add a mild bias toward typical popular-music tempos (80-140).
    let candidates = [
        raw_bpm / 4.0,
        raw_bpm / 3.0,
        raw_bpm / 2.0,
        raw_bpm,
        raw_bpm * 2.0,
        raw_bpm * 3.0,
    ];

    let best = candidates
        .iter()
        .copied()
        .filter(|&b| (40.0..=220.0).contains(&b))
        .max_by(|&a, &b| {
            let score_a = beat_grid_score(a, &intervals);
            let score_b = beat_grid_score(b, &intervals);
            score_a.partial_cmp(&score_b).unwrap()
        })
        .unwrap_or(raw_bpm);

    (best.round() as u32).clamp(40, 220)
}

/// Score a tempo hypothesis by counting intervals that fall near
/// integer multiples / divisions of the beat period.
/// Adds a small bias toward typical popular-music tempos (80-140).
fn beat_grid_score(bpm: f32, intervals: &[f32]) -> f32 {
    let beat_ms = 60000.0 / bpm;
    // Subdivisions to check: 1/4, 1/3, 1/2, 1, 2, 3, 4 beats
    let ratios = [0.25, 0.333, 0.5, 1.0, 2.0, 3.0, 4.0];
    let tolerance_frac = 0.12; // ±12% of beat — allows for human timing

    let mut score = 0.0f32;
    for &iv in intervals {
        let mut best_fit = f32::MAX;
        for &r in &ratios {
            let target = beat_ms * r;
            let rel_err = (iv - target).abs() / target;
            if rel_err < best_fit {
                best_fit = rel_err;
            }
        }
        if best_fit < tolerance_frac {
            // Reward tighter fits more (squared-inverse of error)
            score += 1.0 - (best_fit / tolerance_frac);
        }
    }

    // Bias: multiply by a soft bell around 100 BPM (typical song pace)
    let bias = (-((bpm - 100.0) / 80.0).powi(2)).exp();
    score * (0.5 + 0.5 * bias)
}

fn print_notes(notes: &[Note]) {
    println!();
    println!("  {:>8} | {:>5} | {:>6} | {:>7} | {:>8}", "Time(s)", "Fret", "String", "Freq", "Dur(ms)");
    println!("  {}", "-".repeat(50));
    let string_names = ["hi E", "B", "G", "D", "A", "lo E"];
    for n in notes.iter().take(50) {
        println!(
            "  {:>8.3} | {:>5} | {:>6} | {:>6.1} | {:>8.0}",
            n.time_ms / 1000.0,
            n.fret,
            string_names[n.string as usize],
            n.frequency,
            n.duration_ms
        );
    }
    if notes.len() > 50 {
        println!("  ... ({} more)", notes.len() - 50);
    }
    println!();
}

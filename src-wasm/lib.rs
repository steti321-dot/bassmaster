mod gp4_writer;

use wasm_bindgen::prelude::*;
use serde::{Serialize, Deserialize};
use gp4_writer::{GP4Writer, Track, Beat, Note as GP4Note};

#[wasm_bindgen]
pub struct AudioProcessor;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Note {
    pub fret: u8,
    pub string: u8,
    pub time: f32,
    pub duration: f32,
}

#[derive(Serialize, Deserialize)]
pub struct ProcessingResult {
    pub notes: Vec<Note>,
    pub tempo: u32,
    pub time_signature: TimeSignature,
    pub gp4_data: Vec<u8>,
}

#[derive(Serialize, Deserialize)]
pub struct TimeSignature {
    pub numerator: u8,
    pub denominator: u8,
}

#[wasm_bindgen]
impl AudioProcessor {
    #[wasm_bindgen(constructor)]
    pub fn new() -> AudioProcessor {
        AudioProcessor
    }

    /// Detect pitch from audio buffer using YIN algorithm
    #[wasm_bindgen]
    pub fn detect_pitch(&self, audio_buffer: Vec<f32>, sample_rate: u32) -> f32 {
        Self::detect_pitch_yin(&audio_buffer, sample_rate)
    }

    /// Process audio and return detected notes with GP4 file
    #[wasm_bindgen]
    pub fn process_audio(
        &self,
        audio_buffer: Vec<f32>,
        sample_rate: u32,
    ) -> JsValue {
        let hop_size = 512;
        let mut notes: Vec<Note> = Vec::new();
        let mut prev_fret = -1i32;
        let mut note_start_time = 0.0f32;

        for i in (0..audio_buffer.len().saturating_sub(hop_size)).step_by(hop_size) {
            let chunk = &audio_buffer[i..i.min(i + hop_size)];
            let frequency = Self::detect_pitch_yin(chunk, sample_rate);
            let fret = Self::frequency_to_fret(frequency);
            let time = (i as f32 / sample_rate as f32) * 1000.0;

            if fret != prev_fret {
                if prev_fret >= 0 && !notes.is_empty() {
                    if let Some(last_note) = notes.last_mut() {
                        last_note.duration = time - note_start_time;
                    }
                }

                if fret >= 0 {
                    let string = Self::frequency_to_string(frequency);
                    notes.push(Note {
                        fret: fret as u8,
                        string: string as u8,
                        time,
                        duration: (hop_size as f32 / sample_rate as f32) * 1000.0,
                    });
                    note_start_time = time;
                }

                prev_fret = fret;
            }
        }

        let filtered_notes: Vec<Note> = notes.into_iter().filter(|n| n.fret < 25).collect();
        let tempo = Self::estimate_tempo(&filtered_notes);

        // Generate GP4 file
        let gp4_data = Self::notes_to_gp4(&filtered_notes, tempo as u32);

        let result = ProcessingResult {
            notes: filtered_notes,
            tempo: tempo.round() as u32,
            time_signature: TimeSignature {
                numerator: 4,
                denominator: 4,
            },
            gp4_data,
        };

        serde_wasm_bindgen::to_value(&result).unwrap_or(JsValue::NULL)
    }

    /// Generate GP4 file from notes
    #[wasm_bindgen]
    pub fn generate_gp4(
        &self,
        notes_json: &str,
        tempo: u32,
        title: &str,
        artist: &str,
    ) -> Vec<u8> {
        let notes: Vec<Note> = serde_json::from_str(notes_json).unwrap_or_default();
        Self::notes_to_gp4(&notes, tempo)
    }
}

impl AudioProcessor {
    fn detect_pitch_yin(audio_buffer: &[f32], sample_rate: u32) -> f32 {
        const MIN_FREQ: f32 = 80.0;
        const MAX_FREQ: f32 = 400.0;
        const THRESHOLD: f32 = 0.1;

        let min_period = (sample_rate as f32 / MAX_FREQ).ceil() as usize;
        let max_period = (sample_rate as f32 / MIN_FREQ).floor() as usize;

        let mut best_offset = 0;
        let mut best_correlation = f32::MAX;

        for offset in min_period..max_period.min(audio_buffer.len()) {
            let mut correlation = 0.0f32;
            let mut count = 0;

            for i in 0..audio_buffer.len().saturating_sub(offset) {
                correlation += (audio_buffer[i] - audio_buffer[i + offset]).abs();
                count += 1;
            }

            if count > 0 {
                correlation /= count as f32;

                if correlation < best_correlation * (1.0 - THRESHOLD) {
                    best_correlation = correlation;
                    best_offset = offset;
                }
            }
        }

        if best_offset > 0 && best_correlation < 0.5 {
            sample_rate as f32 / best_offset as f32
        } else {
            0.0
        }
    }

    fn frequency_to_fret(frequency: f32) -> i32 {
        if frequency <= 0.0 || !frequency.is_finite() {
            return -1;
        }

        const REFERENCE_FREQ: f32 = 82.41;
        let fret = (12.0 * (frequency / REFERENCE_FREQ).log2()).round() as i32;

        if fret < 0 || fret > 24 {
            -1
        } else {
            fret
        }
    }

    fn frequency_to_string(frequency: f32) -> i32 {
        let string_tunings = [329.63, 246.94, 196.0, 146.83, 110.0, 82.41];
        let mut closest_string = 5;
        let mut min_diff = f32::MAX;

        for (i, &tuning) in string_tunings.iter().enumerate() {
            let diff = (frequency - tuning).abs();
            if diff < min_diff {
                min_diff = diff;
                closest_string = i as i32;
            }
        }

        closest_string
    }

    fn estimate_tempo(notes: &[Note]) -> f32 {
        if notes.len() < 2 {
            return 120.0;
        }

        let mut intervals = Vec::new();
        for i in 1..notes.len() {
            intervals.push(notes[i].time - notes[i - 1].time);
        }

        intervals.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let median_interval = intervals[intervals.len() / 2];

        let bpm = (60000.0 / median_interval) * 4.0;
        bpm.max(40.0).min(300.0)
    }

    fn notes_to_gp4(notes: &[Note], tempo: u32) -> Vec<u8> {
        let mut writer = GP4Writer::new("Transcription", "AI Generated", tempo);

        // Add default guitar track
        let guitar = Track {
            name: "Guitar".to_string(),
            channel1: 0,
            channel2: 0,
            strings: vec![329, 246, 196, 146, 110, 82],
            fret_count: 24,
            capo_fret: 0,
            color: (255, 0, 0),
        };
        writer.add_track(guitar);

        // Convert notes to beats (simple: one beat per note)
        for note in notes {
            let beat = Beat {
                duration_ms: note.duration,
                notes: vec![GP4Note {
                    fret: note.fret,
                    string: note.string,
                    duration_ms: note.duration,
                    fingering: 0xFF,
                }],
                dotted: false,
            };
            writer.add_beat(0, beat);
        }

        writer.write()
    }
}

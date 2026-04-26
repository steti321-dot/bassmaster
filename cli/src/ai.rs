//! AI-based polyphonic transcription via Spotify's Basic Pitch (Node subprocess).
//!
//! Flow:
//! 1. Write PCM samples to a temp WAV file
//! 2. Spawn `node scripts/basic-pitch-transcribe.mjs <wav>`
//! 3. Parse JSON notes from stdout
//! 4. Convert MIDI pitches to (string, fret) via the existing placement logic

use std::fs::File;
use std::io::BufWriter;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::wav::write_float32_wav;

#[derive(Debug, Clone)]
pub struct AiNote {
    pub start_sec: f32,
    pub duration_sec: f32,
    pub pitch_midi: u8,
    pub amplitude: f32,
}

/// Run Basic Pitch via Node on the given samples. Returns notes with MIDI pitch.
pub fn transcribe_with_basic_pitch(samples: &[f32], sample_rate: u32) -> Result<Vec<AiNote>, String> {
    // Write temp WAV
    let temp_wav = std::env::temp_dir().join(format!("mp3togp4-ai-{}.wav", std::process::id()));
    {
        let file = File::create(&temp_wav).map_err(|e| format!("create temp wav: {}", e))?;
        let mut bw = BufWriter::new(file);
        write_float32_wav(&mut bw, samples, sample_rate).map_err(|e| format!("write wav: {}", e))?;
    }
    println!("  [ai] Wrote temp WAV: {} ({} samples)", temp_wav.display(), samples.len());

    // Find node script
    let script = find_script();
    let script_str = script.to_string_lossy().to_string();
    println!("  [ai] Running: node {}", script_str);

    // Spawn node subprocess
    let output = Command::new("node")
        .arg(&script_str)
        .arg(temp_wav.to_string_lossy().to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .output()
        .map_err(|e| format!("spawn node: {}", e))?;

    let _ = std::fs::remove_file(&temp_wav);

    if !output.status.success() {
        return Err(format!("node exited with status {}", output.status));
    }

    let json_str = String::from_utf8(output.stdout).map_err(|e| format!("utf8 error: {}", e))?;
    parse_json_notes(&json_str)
}

fn find_script() -> PathBuf {
    // Search upward from the binary for `scripts/basic-pitch-transcribe.mjs`
    let exe = std::env::current_exe().ok();
    if let Some(exe) = exe {
        let mut dir = exe.parent().map(Path::to_path_buf);
        while let Some(d) = dir {
            let candidate = d.join("scripts").join("basic-pitch-transcribe.mjs");
            if candidate.exists() {
                return candidate;
            }
            dir = d.parent().map(Path::to_path_buf);
        }
    }
    // Fallback
    PathBuf::from("scripts/basic-pitch-transcribe.mjs")
}

/// Parse JSON output from the Node script. Minimal hand-rolled parser to avoid adding a
/// JSON dep. Expects: { "notes": [ { "start": X, "duration": Y, "pitchMidi": Z, "amplitude": W }, ... ] }
fn parse_json_notes(json: &str) -> Result<Vec<AiNote>, String> {
    let notes_start = json
        .find("\"notes\"")
        .ok_or("missing 'notes' field in output")?;
    let array_start = json[notes_start..]
        .find('[')
        .ok_or("malformed notes array")?
        + notes_start;
    let array_end = json.rfind(']').ok_or("no closing ]")?;
    let array = &json[array_start + 1..array_end];

    let mut notes = Vec::new();
    let mut depth = 0;
    let mut obj_start = None;

    for (i, c) in array.char_indices() {
        match c {
            '{' => {
                if depth == 0 {
                    obj_start = Some(i);
                }
                depth += 1;
            }
            '}' => {
                depth -= 1;
                if depth == 0 {
                    if let Some(start) = obj_start.take() {
                        let obj = &array[start..=i];
                        if let Some(n) = parse_note_object(obj) {
                            notes.push(n);
                        }
                    }
                }
            }
            _ => {}
        }
    }

    Ok(notes)
}

fn parse_note_object(obj: &str) -> Option<AiNote> {
    Some(AiNote {
        start_sec: extract_number(obj, "\"start\"")?,
        duration_sec: extract_number(obj, "\"duration\"")?,
        pitch_midi: extract_number(obj, "\"pitchMidi\"")? as u8,
        amplitude: extract_number(obj, "\"amplitude\"").unwrap_or(0.5),
    })
}

fn extract_number(obj: &str, key: &str) -> Option<f32> {
    let idx = obj.find(key)?;
    let after_key = &obj[idx + key.len()..];
    let colon = after_key.find(':')?;
    let rest = &after_key[colon + 1..];

    let mut end = 0;
    for (i, c) in rest.char_indices() {
        if c == ',' || c == '}' || c == ']' {
            end = i;
            break;
        }
    }
    if end == 0 {
        end = rest.len();
    }
    rest[..end].trim().parse::<f32>().ok()
}

/// Convert MIDI note number to frequency.
pub fn midi_to_hz(midi: u8) -> f32 {
    440.0 * 2.0f32.powf((midi as i32 - 69) as f32 / 12.0)
}

/// GP4 Binary Format Writer
/// Implements the Guitar Pro 4 file format specification

use std::io::Write;

#[derive(Clone, Debug)]
pub struct Note {
    pub fret: u8,
    pub string: u8, // 0 = high E, 5 = low E
    pub duration_ms: f32,
    pub fingering: u8, // 0-5 or 0xFF for unknown
}

#[derive(Clone, Debug)]
pub struct Beat {
    pub duration_ms: f32,
    pub notes: Vec<Note>,
    pub dotted: bool,
}

pub struct GP4Writer {
    title: String,
    artist: String,
    album: String,
    author: String,
    copyright: String,
    comments: String,
    tempo: u32,
    key_signature: i8,  // -7 to 7 (sharps/flats)
    is_minor: bool,
    measures: Vec<Vec<Beat>>, // measures[track_idx][beat_idx]
    tracks: Vec<Track>,
}

pub struct Track {
    pub name: String,
    pub channel1: u8,
    pub channel2: u8,
    pub strings: Vec<u32>, // Tuning in Hz
    pub fret_count: u8,
    pub capo_fret: u8,
    pub color: (u8, u8, u8),
}

impl Default for Track {
    fn default() -> Self {
        Track {
            name: "Guitar".to_string(),
            channel1: 0,
            channel2: 0,
            strings: vec![329, 246, 196, 146, 110, 82], // Standard tuning approximation
            fret_count: 24,
            capo_fret: 0,
            color: (255, 0, 0),
        }
    }
}

impl GP4Writer {
    pub fn new(title: &str, artist: &str, tempo: u32) -> Self {
        GP4Writer {
            title: title.to_string(),
            artist: artist.to_string(),
            album: String::new(),
            author: String::new(),
            copyright: String::new(),
            comments: String::new(),
            tempo: tempo.max(40).min(300),
            key_signature: 0,
            is_minor: false,
            measures: vec![vec![]],
            tracks: vec![Track::default()],
        }
    }

    pub fn add_track(&mut self, track: Track) {
        self.tracks.push(track);
        self.measures.push(vec![]);
    }

    pub fn add_beat(&mut self, track_idx: usize, beat: Beat) {
        if track_idx < self.measures.len() {
            self.measures[track_idx].push(beat);
        }
    }

    pub fn write(&self) -> Vec<u8> {
        let mut buf = Vec::new();

        // Header
        self.write_header(&mut buf);

        // Tracks
        self.write_tracks(&mut buf);

        // Measures and notes
        self.write_measures(&mut buf);

        buf
    }

    fn write_header(&self, buf: &mut Vec<u8>) {
        // Version string
        let version = "FICHIER GUITAR PRO v4.06";
        Self::write_string(buf, version);

        // Metadata strings
        Self::write_string(buf, &self.title);
        Self::write_string(buf, &self.artist);
        Self::write_string(buf, &self.album);
        Self::write_string(buf, &self.author);
        Self::write_string(buf, &self.copyright);
        Self::write_string(buf, &self.comments);

        // Tempo
        Self::write_int(buf, self.tempo);

        // Key signature: byte for key (-7=7 flats to 7=7 sharps), byte for minor flag
        buf.push((self.key_signature as i8 + 7) as u8); // Convert to 0-14 range
        buf.push(if self.is_minor { 1 } else { 0 });

        // MIDI channels: 4 ports × 16 channels = 64 channels
        for _ in 0..64 {
            // Channel info: Program, Volume, Balance, Chorus, Reverb, Phaser, Tremolo
            buf.push(0);     // Program
            buf.push(104);   // Volume (default)
            buf.push(64);    // Balance (center)
            buf.push(0);     // Chorus
            buf.push(0);     // Reverb
            buf.push(0);     // Phaser
            buf.push(0);     // Tremolo
        }

        // Number of measures
        let num_measures = self.get_max_measures();
        Self::write_int(buf, num_measures as u32);

        // Number of tracks
        Self::write_int(buf, self.tracks.len() as u32);

        // Measure headers
        self.write_measure_headers(buf, num_measures);
    }

    fn write_tracks(&self, buf: &mut Vec<u8>) {
        for track in &self.tracks {
            // Channel 1 and 2 (MIDI port/channel)
            buf.push(track.channel1);
            buf.push(track.channel2);

            // Fret count and capo
            buf.push(track.fret_count);
            buf.push(track.capo_fret);

            // Color (RGB)
            buf.push(track.color.0);
            buf.push(track.color.1);
            buf.push(track.color.2);
            buf.push(0); // Padding

            // Track name (null-terminated, max 40 chars)
            let name_bytes = track.name.as_bytes();
            for &b in &name_bytes[..name_bytes.len().min(40)] {
                buf.push(b);
            }
            buf.push(0); // Null terminator

            // String tunings (6 strings, 4 bytes each, LSB first)
            for &tuning in &track.strings {
                Self::write_int(buf, tuning);
            }
        }
    }

    fn write_measures(&self, buf: &mut Vec<u8>) {
        let num_measures = self.get_max_measures();

        // Measure-track pairs
        for measure_idx in 0..num_measures {
            for track_idx in 0..self.tracks.len() {
                let beats = if measure_idx < self.measures[track_idx].len() {
                    &self.measures[track_idx][measure_idx]
                } else {
                    &[]
                };

                // Number of beats in this measure
                Self::write_int(buf, beats.len() as u32);

                // Write each beat
                for beat in beats {
                    self.write_beat(buf, beat);
                }
            }
        }
    }

    fn write_beat(&self, buf: &mut Vec<u8>, beat: &Beat) {
        // Beat status byte (flags for what data is present)
        let mut status = 0x20u8; // Start with "has notes" flag

        if beat.dotted {
            status |= 0x01; // Dotted flag
        }

        buf.push(status);

        // Duration type and dotting
        let duration_type = Self::duration_to_type(beat.duration_ms);
        buf.push(duration_type);

        // Write notes
        for note in &beat.notes {
            self.write_note(buf, note);
        }
    }

    fn write_note(&self, buf: &mut Vec<u8>, note: &Note) {
        // Note status byte
        let mut note_status = 0x20u8; // Fret present flag

        buf.push(note_status);

        // Fret number
        buf.push(note.fret);

        // Fingering
        buf.push(note.fingering);

        // Accentuation (default: off)
        buf.push(0);

        // Dynamics (default: default)
        buf.push(0x00);
    }

    fn write_measure_headers(&self, buf: &mut Vec<u8>, num_measures: usize) {
        for _ in 0..num_measures {
            // Flags byte: presence of data
            let flags = 0x3F; // All standard fields present
            buf.push(flags);

            // Time signature
            buf.push(4); // Numerator
            buf.push(2); // Denominator (power of 2)

            // Tempo change flag
            buf.push(0); // No tempo change

            // Other headers (repeats, marker, etc.)
            // For MVP, we keep it minimal
        }
    }

    fn get_max_measures(&self) -> usize {
        self.measures.iter().map(|m| m.len()).max().unwrap_or(1).max(1)
    }

    fn duration_to_type(duration_ms: f32) -> u8 {
        // Assuming 120 BPM = 500ms per beat
        // Adjust based on actual tempo for accuracy
        if duration_ms < 150.0 {
            4 // Sixteenth
        } else if duration_ms < 300.0 {
            3 // Eighth
        } else if duration_ms < 600.0 {
            2 // Quarter
        } else if duration_ms < 1200.0 {
            1 // Half
        } else {
            0 // Whole
        }
    }

    fn write_string(buf: &mut Vec<u8>, s: &str) {
        let bytes = s.as_bytes();
        let len = bytes.len().min(255);
        buf.push(len as u8);
        buf.extend_from_slice(&bytes[..len]);
    }

    fn write_int(buf: &mut Vec<u8>, v: u32) {
        buf.extend_from_slice(&v.to_le_bytes());
    }
}

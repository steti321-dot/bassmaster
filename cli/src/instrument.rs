//! Instrument profile: tuning, frequency range, and fret count.
//! Determines how detected pitches are mapped to (string, fret) pairs and
//! how the GP4 file describes the instrument.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Instrument {
    Guitar,
    Bass,
}

impl Instrument {
    /// Open-string tunings, ordered from highest pitch (index 0) to lowest.
    pub fn tunings_hz(self) -> &'static [f32] {
        match self {
            // Standard 6-string guitar: hi E, B, G, D, A, lo E
            Instrument::Guitar => &[329.63, 246.94, 196.00, 146.83, 110.00, 82.41],
            // Standard 4-string bass: G, D, A, E
            Instrument::Bass => &[98.00, 73.42, 55.00, 41.20],
        }
    }

    pub fn string_count(self) -> usize {
        self.tunings_hz().len()
    }

    /// Reference frequency for fret 0 on the *lowest* string.
    pub fn lowest_open_hz(self) -> f32 {
        *self.tunings_hz().last().unwrap()
    }

    /// Pitch detection lower bound (Hz). Below this, we assume noise/unrecognized.
    pub fn min_pitch_hz(self) -> f32 {
        match self {
            Instrument::Guitar => 70.0, // a bit below low E (82Hz)
            Instrument::Bass => 35.0,   // below low E1 (41Hz)
        }
    }

    /// Pitch detection upper bound (Hz). Highest note within fret range.
    pub fn max_pitch_hz(self) -> f32 {
        match self {
            // Guitar fret 24 on high E ≈ 1318 Hz
            Instrument::Guitar => 1500.0,
            // Bass fret 24 on G string ≈ 392 Hz
            Instrument::Bass => 450.0,
        }
    }

    pub fn fret_count(self) -> u8 {
        24
    }

    /// MIDI tunings (note numbers) for the GP4 track header.
    pub fn midi_tunings(self) -> &'static [u32] {
        match self {
            // E4=64, B3=59, G3=55, D3=50, A2=45, E2=40
            Instrument::Guitar => &[64, 59, 55, 50, 45, 40],
            // G2=43, D2=38, A1=33, E1=28
            Instrument::Bass => &[43, 38, 33, 28],
        }
    }

    /// Default GP4 MIDI instrument program number.
    pub fn midi_program(self) -> u8 {
        match self {
            Instrument::Guitar => 24, // Acoustic Nylon Guitar
            Instrument::Bass => 33,   // Electric Bass (Finger)
        }
    }

    pub fn track_name(self) -> &'static str {
        match self {
            Instrument::Guitar => "Guitar",
            Instrument::Bass => "Bass",
        }
    }
}

impl Default for Instrument {
    fn default() -> Self {
        Instrument::Guitar
    }
}

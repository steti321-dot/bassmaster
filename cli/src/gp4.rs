//! GP4 binary file format writer
//! Ref: https://dguitar.sourceforge.net/GP4format.html

use crate::instrument::Instrument;
use crate::Note;

pub fn write_gp4(notes: &[Note], tempo: u32, title: &str, artist: &str, instrument: Instrument) -> Vec<u8> {
    let mut buf = Vec::new();

    // Version string: 30-byte padded — "FICHIER GUITAR PRO v4.06"
    write_version_string(&mut buf, "FICHIER GUITAR PRO v4.06");

    // Metadata strings (each is byte-length-prefixed C string, then int-prefixed string)
    write_int_string(&mut buf, title); // Title
    write_int_string(&mut buf, ""); // Subtitle
    write_int_string(&mut buf, artist); // Artist
    write_int_string(&mut buf, ""); // Album
    write_int_string(&mut buf, "MP3 to GP4"); // Author
    write_int_string(&mut buf, ""); // Copyright
    write_int_string(&mut buf, ""); // Tab author
    write_int_string(&mut buf, ""); // Instructions

    // Notice lines
    write_int(&mut buf, 0); // 0 notice lines

    // Triplet feel
    buf.push(0);

    // Lyrics: track (int) + 5 × (measure_start int, lyrics string)
    write_int(&mut buf, 0); // associated track
    for _ in 0..5 {
        write_int(&mut buf, 0); // measure start
        write_int(&mut buf, 0); // empty lyrics (length-prefixed string, len=0)
    }

    // Tempo
    write_int(&mut buf, tempo);

    // Key signature: 1 byte key (-7..7) + 1 byte minor flag
    buf.push(0);
    buf.push(0);

    // Octave: 1 byte (8va type)
    buf.push(0);

    // MIDI channels: 64 channels × 12 bytes each (instrument + 7 effect bytes + 2 padding)
    for i in 0..64 {
        let program: i32 = if i == 9 { 0 } else { instrument.midi_program() as i32 };
        write_int(&mut buf, program as u32);
        buf.push(13); // Volume
        buf.push(8); // Balance
        buf.push(0); // Chorus
        buf.push(0); // Reverb
        buf.push(0); // Phaser
        buf.push(0); // Tremolo
        buf.push(0); // Padding
        buf.push(0); // Padding
    }

    // Notes: measure count + track count
    let measures = group_into_measures(notes, tempo);
    let num_measures = measures.len().max(1);
    write_int(&mut buf, num_measures as u32);
    write_int(&mut buf, 1); // 1 track

    // Measure headers
    for i in 0..num_measures {
        write_measure_header(&mut buf, i == 0);
    }

    // Track definitions
    write_track(&mut buf, instrument);

    // Measure-track beat data
    for measure in &measures {
        write_int(&mut buf, measure.len() as u32); // beat count
        for note in measure {
            write_beat(&mut buf, note);
        }
    }
    // Ensure at least one empty measure
    if measures.is_empty() {
        write_int(&mut buf, 0);
    }

    buf
}

fn group_into_measures(notes: &[Note], tempo: u32) -> Vec<Vec<&Note>> {
    let ms_per_measure = (60000.0 / tempo as f32) * 4.0; // 4/4 time
    if notes.is_empty() {
        return vec![vec![]];
    }
    let total_ms = notes.last().unwrap().time_ms + notes.last().unwrap().duration_ms;
    let num_measures = (total_ms / ms_per_measure).ceil() as usize;
    let mut measures: Vec<Vec<&Note>> = (0..num_measures.max(1)).map(|_| Vec::new()).collect();
    for note in notes {
        let idx = ((note.time_ms / ms_per_measure) as usize).min(measures.len() - 1);
        measures[idx].push(note);
    }
    measures
}

fn write_measure_header(buf: &mut Vec<u8>, is_first: bool) {
    let mut flags: u8 = 0;
    if is_first {
        flags |= 0x01 | 0x02; // numerator + denominator
    }
    buf.push(flags);
    if is_first {
        buf.push(4); // numerator
        buf.push(2); // denominator (2^2 = 4)
    }
    // No repeats, no markers, no key sig change, no double bar
}

fn write_track(buf: &mut Vec<u8>, instrument: Instrument) {
    // Flags: 0x01 drums? 0x02 12-string? 0x04 banjo? → 0 = standard
    buf.push(0);

    // Track name: padded 40 bytes
    let name = instrument.track_name();
    let name_bytes = name.as_bytes();
    buf.push(name_bytes.len() as u8);
    for i in 0..40 {
        if i < name_bytes.len() {
            buf.push(name_bytes[i]);
        } else {
            buf.push(0);
        }
    }

    // Number of strings
    let strings = instrument.midi_tunings();
    write_int(buf, strings.len() as u32);

    // GP4 always has 7 string slots in track def — pad unused with 0.
    for slot in 0..7 {
        let note = strings.get(slot).copied().unwrap_or(0);
        write_int(buf, note);
    }

    // MIDI port, channel, effect channel, frets, capo, color
    write_int(buf, 1); // port
    write_int(buf, 1); // channel
    write_int(buf, 2); // effect channel
    write_int(buf, instrument.fret_count() as u32);
    write_int(buf, 0); // capo

    // Color: 4 bytes RGB + padding (red for guitar, blue for bass)
    let (r, g, b) = match instrument {
        Instrument::Guitar => (255, 0, 0),
        Instrument::Bass => (0, 100, 255),
    };
    buf.push(r);
    buf.push(g);
    buf.push(b);
    buf.push(0);
}

fn write_beat(buf: &mut Vec<u8>, note: &Note) {
    // Beat header: 0x20 = has notes mask
    buf.push(0);

    // Beat status
    buf.push(0);

    // Duration: -2=whole, -1=half, 0=quarter, 1=eighth, 2=16th, 3=32nd, 4=64th
    let duration: i8 = if note.duration_ms > 800.0 {
        -1
    } else if note.duration_ms > 400.0 {
        0
    } else if note.duration_ms > 200.0 {
        1
    } else if note.duration_ms > 100.0 {
        2
    } else {
        3
    };
    buf.push(duration as u8);

    // String mask: 1 byte, bit set for each played string (bit 6 = string 0)
    let string_mask: u8 = 1 << (6 - note.string);
    buf.push(string_mask);

    // For each played string: note data
    // Note header byte
    buf.push(0x20); // fret value present
    // Note type: 1 = normal
    buf.push(1);
    // Fret
    buf.push(note.fret);
}

fn write_version_string(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let len = bytes.len().min(30);
    buf.push(len as u8);
    for i in 0..30 {
        if i < len {
            buf.push(bytes[i]);
        } else {
            buf.push(0);
        }
    }
}

fn write_int_string(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    // Int prefix: (length+1) as 4-byte LE
    write_int(buf, (bytes.len() + 1) as u32);
    // Byte prefix: length as 1 byte
    buf.push(bytes.len() as u8);
    buf.extend_from_slice(bytes);
}

fn write_int(buf: &mut Vec<u8>, v: u32) {
    buf.extend_from_slice(&v.to_le_bytes());
}

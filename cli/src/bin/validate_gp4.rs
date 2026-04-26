//! Validate a GP4 file by parsing its header and structure.
//! Usage: validate_gp4 <file.gp4>

use std::env;
use std::fs;
use std::process::exit;

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: validate_gp4 <file.gp4>");
        exit(1);
    }

    let data = match fs::read(&args[1]) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("Cannot read {}: {}", args[1], e);
            exit(1);
        }
    };

    println!("🔍 Validating {} ({} bytes)", args[1], data.len());
    println!();

    let mut cursor = Cursor::new(&data);
    let mut errors = Vec::new();

    // Version header: 30-byte padded
    let version = cursor.read_version_string().unwrap_or_default();
    println!("Version: \"{}\"", version);
    if version != "FICHIER GUITAR PRO v4.06" {
        errors.push(format!("Unexpected version string: \"{}\"", version));
    }

    // Metadata strings
    for field in ["Title", "Subtitle", "Artist", "Album", "Author", "Copyright", "Tab Author", "Instructions"] {
        match cursor.read_int_string() {
            Ok(s) => println!("{}: \"{}\"", field, s),
            Err(e) => {
                errors.push(format!("Failed to read {}: {}", field, e));
                break;
            }
        }
    }

    // Notice lines count
    match cursor.read_int() {
        Ok(n) => println!("Notice lines: {}", n),
        Err(e) => errors.push(format!("Failed to read notice count: {}", e)),
    }

    // Triplet feel
    match cursor.read_byte() {
        Ok(b) => println!("Triplet feel: {}", b),
        Err(e) => errors.push(format!("Failed to read triplet feel: {}", e)),
    }

    // Lyrics: associated track + 5 lines
    let _ = cursor.read_int();
    for _ in 0..5 {
        let _ = cursor.read_int();
        let _ = cursor.read_int();
    }

    // Tempo
    match cursor.read_int() {
        Ok(t) => {
            println!("Tempo: {} BPM", t);
            if !(40..=300).contains(&t) {
                errors.push(format!("Tempo {} out of range", t));
            }
        }
        Err(e) => errors.push(format!("Failed to read tempo: {}", e)),
    }

    // Key signature + minor
    let key = cursor.read_byte().unwrap_or(0);
    let minor = cursor.read_byte().unwrap_or(0);
    println!("Key: {} ({})", key as i8, if minor == 1 { "minor" } else { "major" });

    // Octave
    let _ = cursor.read_byte();

    // Skip MIDI channels (64 × 12 bytes = 768 bytes)
    cursor.skip(64 * 12);
    println!("MIDI channels: 64 × 12 bytes skipped");

    // Measure count + track count
    let num_measures = cursor.read_int().unwrap_or(0);
    let num_tracks = cursor.read_int().unwrap_or(0);
    println!("Measures: {}, Tracks: {}", num_measures, num_tracks);

    if num_measures == 0 {
        errors.push("Zero measures (expected ≥ 1)".to_string());
    }
    if num_tracks == 0 {
        errors.push("Zero tracks (expected ≥ 1)".to_string());
    }

    println!();
    if errors.is_empty() {
        println!("✅ Structure looks valid (read {} of {} bytes)", cursor.pos, data.len());
    } else {
        println!("⚠️  Found {} issue(s):", errors.len());
        for e in &errors {
            println!("   • {}", e);
        }
        exit(1);
    }

    // Hex dump first 80 bytes
    println!();
    println!("Hex dump (first 80 bytes):");
    for (i, chunk) in data.chunks(16).take(5).enumerate() {
        let offset = i * 16;
        let hex: String = chunk.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(" ");
        let ascii: String = chunk
            .iter()
            .map(|&b| if (32..127).contains(&b) { b as char } else { '.' })
            .collect();
        println!("  {:04x}: {:<48}  {}", offset, hex, ascii);
    }
}

struct Cursor<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Cursor<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn read_byte(&mut self) -> Result<u8, String> {
        if self.pos >= self.data.len() {
            return Err("EOF".into());
        }
        let b = self.data[self.pos];
        self.pos += 1;
        Ok(b)
    }

    fn read_int(&mut self) -> Result<u32, String> {
        if self.pos + 4 > self.data.len() {
            return Err("EOF reading u32".into());
        }
        let v = u32::from_le_bytes(self.data[self.pos..self.pos + 4].try_into().unwrap());
        self.pos += 4;
        Ok(v)
    }

    fn skip(&mut self, n: usize) {
        self.pos = (self.pos + n).min(self.data.len());
    }

    fn read_version_string(&mut self) -> Result<String, String> {
        // 1-byte length followed by 30-byte buffer
        let len = self.read_byte()? as usize;
        if self.pos + 30 > self.data.len() {
            return Err("EOF reading version".into());
        }
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + len.min(30)]).into_owned();
        self.pos += 30;
        Ok(s)
    }

    fn read_int_string(&mut self) -> Result<String, String> {
        let total_plus_one = self.read_int()? as usize;
        if total_plus_one == 0 {
            return Ok(String::new());
        }
        let byte_len = self.read_byte()? as usize;
        if self.pos + byte_len > self.data.len() {
            return Err(format!("EOF reading {}-byte string", byte_len));
        }
        let s = String::from_utf8_lossy(&self.data[self.pos..self.pos + byte_len]).into_owned();
        self.pos += byte_len;
        Ok(s)
    }
}

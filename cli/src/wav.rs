//! Minimal WAV file writer for PCM float32 audio.
//! Used to hand off decoded audio to Node scripts that can't read m4a/webm.

use std::io::{self, Write};

/// Write a WAV file: mono, 32-bit float PCM, given sample rate.
pub fn write_float32_wav<W: Write>(
    writer: &mut W,
    samples: &[f32],
    sample_rate: u32,
) -> io::Result<()> {
    let num_samples = samples.len() as u32;
    let bits_per_sample: u16 = 32;
    let num_channels: u16 = 1;
    let byte_rate = sample_rate * num_channels as u32 * bits_per_sample as u32 / 8;
    let block_align = num_channels * bits_per_sample / 8;
    let data_size = num_samples * block_align as u32;
    let chunk_size = 36 + data_size;

    // RIFF header
    writer.write_all(b"RIFF")?;
    writer.write_all(&chunk_size.to_le_bytes())?;
    writer.write_all(b"WAVE")?;

    // fmt chunk (size 16, format 3 = IEEE float)
    writer.write_all(b"fmt ")?;
    writer.write_all(&16u32.to_le_bytes())?;
    writer.write_all(&3u16.to_le_bytes())?; // format: IEEE float
    writer.write_all(&num_channels.to_le_bytes())?;
    writer.write_all(&sample_rate.to_le_bytes())?;
    writer.write_all(&byte_rate.to_le_bytes())?;
    writer.write_all(&block_align.to_le_bytes())?;
    writer.write_all(&bits_per_sample.to_le_bytes())?;

    // data chunk
    writer.write_all(b"data")?;
    writer.write_all(&data_size.to_le_bytes())?;
    for &s in samples {
        writer.write_all(&s.to_le_bytes())?;
    }

    Ok(())
}

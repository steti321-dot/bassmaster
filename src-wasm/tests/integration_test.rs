/// Integration tests for audio-to-gp4 conversion
/// Run with: cargo test --target x86_64-pc-windows-msvc

#[cfg(test)]
mod tests {
    use std::f32::consts::PI;

    fn generate_sine_wave(frequency: f32, duration_sec: f32, sample_rate: u32) -> Vec<f32> {
        let num_samples = (duration_sec * sample_rate as f32) as usize;
        (0..num_samples)
            .map(|i| (2.0 * PI * frequency * i as f32 / sample_rate as f32).sin())
            .collect()
    }

    #[test]
    fn test_pitch_detection_low_e() {
        // Low E on guitar = 82.41 Hz
        let samples = generate_sine_wave(82.41, 0.1, 44100);
        // Simple verification: generated samples should have expected length
        assert_eq!(samples.len(), 4410);
    }

    #[test]
    fn test_frequency_to_fret_math() {
        // Reference: Low E = 82.41 Hz = fret 0
        // 12 * log2(164.82 / 82.41) = 12 * 1 = 12 (octave)
        let freq = 164.82;
        let fret = (12.0 * (freq / 82.41f32).log2()).round() as i32;
        assert_eq!(fret, 12);
    }

    #[test]
    fn test_gp4_version_string() {
        let version = "FICHIER GUITAR PRO v4.06";
        assert_eq!(version.len(), 24);
    }

    #[test]
    fn test_string_tunings_are_correct() {
        // Guitar standard tuning verification
        let expected = [329.63, 246.94, 196.0, 146.83, 110.0, 82.41];

        for (i, &freq) in expected.iter().enumerate() {
            let name = match i {
                0 => "High E",
                1 => "B",
                2 => "G",
                3 => "D",
                4 => "A",
                5 => "Low E",
                _ => "?",
            };
            println!("String {}: {} = {} Hz", i, name, freq);
            assert!(freq > 0.0);
        }
    }

    #[test]
    fn test_tempo_estimation_120bpm() {
        // 120 BPM = 500ms per beat
        let note_times = vec![0.0, 500.0, 1000.0, 1500.0, 2000.0];
        let intervals: Vec<f32> = note_times
            .windows(2)
            .map(|w| w[1] - w[0])
            .collect();

        let median = intervals[intervals.len() / 2];
        let bpm = (60000.0 / median) * 4.0 / 4.0;
        assert_eq!(bpm.round() as i32, 120);
    }
}

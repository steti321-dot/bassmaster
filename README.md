# MP3 to GP4 - Audio to Guitar Tabs

Convert audio files and YouTube videos to Guitar Pro notation (GP4 format) with AI-powered pitch detection.

## Project Architecture

### Frontend
- **Electron**: Cross-platform desktop application
- **React + TypeScript**: Modern UI with real-time updates
- **ffmpeg.wasm**: Browser-based audio extraction (no external dependencies)

### Backend (Audio Processing)
- **Rust/WASM**: High-performance pitch detection and audio analysis
- **Web Workers**: Non-blocking audio processing
- **YIN Algorithm**: Fast, accurate monophonic pitch detection

### Core Features
- 🎵 Detect notes from audio with <60s processing time
- 📝 Manual note editor with fretboard visualization
- 💾 Export to GP4 (Guitar Pro 4) format
- 🎬 YouTube URL support (coming soon)
- 📁 Local file upload (MP3, WAV, M4A, MP4, WebM, OGG)

---

## Project Structure

```
mp3togp4/
├── src/
│   ├── electron/
│   │   └── main.ts              # Electron app entry point
│   ├── renderer/
│   │   ├── App.tsx              # Main React component
│   │   ├── App.css
│   │   └── index.tsx
│   ├── pages/
│   │   ├── Upload.tsx           # File/YouTube input UI
│   │   ├── Upload.css
│   │   ├── Editor.tsx           # Note editor & fretboard
│   │   └── Editor.css
│   ├── services/
│   │   └── audioService.ts      # Audio extraction via ffmpeg.wasm
│   └── workers/
│       └── audioWorker.ts       # Web Worker for WASM pitch detection
│
├── src-wasm/
│   ├── lib.rs                   # Main WASM module entry
│   └── gp4_writer.rs            # GP4 binary file generator
│
├── public/
│   └── index.html               # HTML template
│
├── package.json                 # Node dependencies
├── Cargo.toml                   # Rust/WASM dependencies
├── tsconfig.json                # TypeScript config
└── tsconfig.electron.json       # Electron-specific TS config
```

---

## Setup & Development

### Prerequisites
- **Node.js 18+** and npm
- **Rust 1.70+** with `wasm-pack`
- **Electron 27+** (installed via npm)

### Installation

1. **Clone and install dependencies:**
   ```bash
   npm install
   ```

2. **Install Rust WASM toolchain** (if not already installed):
   ```bash
   rustup target add wasm32-unknown-unknown
   cargo install wasm-pack
   ```

3. **Build WASM module** (development):
   ```bash
   npm run build:wasm
   ```

### Development

**Option 1: Run in development mode with hot reload**
```bash
npm run dev
```
This starts both the React dev server and Electron app.

**Option 2: Build everything then run**
```bash
npm run build
npm start
```

### Testing Individual Components

**Test Rust WASM locally:**
```bash
cd src-wasm
cargo test
```

**Test pitch detection with sample audio:**
```bash
cd src-wasm
cargo build --target wasm32-unknown-unknown
```

---

## MVP Feature Set

✅ **Phase 1 (Current)**
- [x] Electron + React scaffold
- [x] Local file upload (MP3, WAV, etc.)
- [x] Pitch detection (YIN algorithm in Rust/WASM)
- [x] Note-to-fret conversion
- [x] Tempo/BPM estimation
- [x] GP4 binary writer
- [x] Manual note editor UI
- [x] Fretboard visualization
- [ ] YouTube video download (ytdl-core ready)
- [ ] ffmpeg.wasm integration

🚧 **Phase 2 (Future)**
- [ ] Multi-track source separation (drums, bass, melody)
- [ ] Standard notation output (staff notation)
- [ ] Advanced effects (bends, hammer-ons, slides)
- [ ] Lyrics synchronization
- [ ] Audio waveform editor

---

## Audio Processing Pipeline

```
1. User uploads file (local) or provides URL (YouTube)
   ↓
2. ffmpeg.wasm extracts audio → PCM float32 buffer
   ↓
3. Web Worker receives buffer, sends to WASM
   ↓
4. Rust WASM processes:
   • Pitch detection (YIN autocorrelation) → frequencies
   • Frequency → fret number conversion
   • Tempo estimation (beat interval analysis)
   • Note clustering (group by fret + string)
   ↓
5. Results returned to React UI:
   • List of notes with fret, string, time, duration
   • Detected tempo
   • Time signature (default 4/4)
   ↓
6. User edits notes in Editor UI
   ↓
7. Export → GP4Writer generates binary file
   ↓
8. User downloads .gp4 file, opens in Guitar Pro
```

---

## Key Technologies

### Pitch Detection: YIN Algorithm
- **Autocorrelation-based**: Fast, reliable for monophonic audio
- **No training required**: Works with any guitar without ML models
- **Real-time capable**: Processes 44.1kHz audio in <60s for 3-min song

### GP4 Format Implementation
- **Custom Rust serializer**: No external dependencies
- **Supports**:
  - Single/multi-track files
  - Note properties (fret, string, duration, fingering)
  - Tempo, key signature, time signature
  - Basic MIDI settings
- **MVP scope**: Single guitar track with standard notes

### ffmpeg.wasm
- Browser-based, no installation required
- Converts MP3/MP4/WebM → PCM WAV
- ~30MB bundle (loaded on-demand)

---

## Build & Deployment

**Build for production:**
```bash
npm run build
npm run build:wasm -- --release
```

**Create distributable package:**
```bash
npm run package
```
(Uses electron-builder, configure in package.json)

---

## Known Limitations (MVP)

1. **Monophonic only**: Detects single note at a time (not chords)
2. **Constant tempo**: Assumes steady BPM
3. **Standard tuning only**: Assumes standard guitar tuning
4. **No effects**: Bends, slides, harmonics not yet supported
5. **4/4 time only**: Default time signature

---

## Testing Notes

**Test with simple files first:**
- Single melodic instrument (not polyphonic)
- Clear, clean audio (low noise)
- Standard tuning (E A D G B E)
- Constant tempo (no tempo changes)

**Example test workflow:**
1. Record simple guitar riff (10-15 seconds)
2. Save as MP3
3. Upload in app
4. Verify detected notes match expected tabs
5. Export GP4, open in Guitar Pro, verify playback

---

## Troubleshooting

**App won't start:**
- Ensure Node.js 18+ installed: `node -v`
- Clear npm cache: `npm cache clean --force`
- Reinstall: `rm -rf node_modules && npm install`

**WASM won't compile:**
- Install toolchain: `rustup target add wasm32-unknown-unknown`
- Install wasm-pack: `cargo install wasm-pack`
- Try clean build: `rm -rf target && npm run build:wasm`

**Audio processing fails:**
- Check browser console (Dev Tools)
- Verify ffmpeg.wasm CDN access
- Test with different audio format

---

## Important Documentation & References

### GP4 / Guitar Pro Format
Since the GP4 format is proprietary and has no official documentation, these reverse-engineered specs are critical:

- **[dGuitar GP4 Format Specification](https://dguitar.sourceforge.net/GP4format.html)** ⭐ PRIMARY REFERENCE
  - Complete byte-level binary structure
  - Measure headers, track definitions, beat encoding
  - Use this when implementing/debugging [gp4_writer.rs](src-wasm/gp4_writer.rs)

- **[PyGuitarPro Format Documentation](https://pyguitarpro.readthedocs.io/en/stable/pyguitarpro/format.html)**
  - Python reference implementation (for comparison)
  - Well-documented data types and parsing logic

- **[music-notation.info - Guitar Pro Format](http://www.music-notation.info/en/formats/GuitarProFormat.html)**
  - Cross-version comparison (.gp3, .gp4, .gp5, .gpx)
  - Useful for understanding format evolution

- **[alphaTab - Guitar Pro 3-5 Parser](https://alphatab.net/docs/formats/guitar-pro-3-5)**
  - JavaScript/TypeScript parser (alternative reference)
  - Good for validating our Rust implementation

### Audio Processing & Pitch Detection

- **YIN Algorithm Paper**: "YIN, a fundamental frequency estimator for speech and music" by de Cheveigné & Kawahara (2002)
  - The algorithm implemented in [lib.rs](src-wasm/lib.rs) `detect_pitch_yin()`
  - Autocorrelation-based monophonic pitch detection

- **[librosa Documentation](https://librosa.org/)** (Python, for reference)
  - Excellent docs on audio analysis concepts (tempo, onset, pitch)
  - Reference for algorithm choices even though we use Rust

- **[Essentia](https://essentia.upf.edu/)** — Music audio analysis library
  - Advanced algorithms we may port to Rust in Phase 2

### Technology Stack

- **[Electron Documentation](https://www.electronjs.org/docs/latest)**
- **[React Documentation](https://react.dev/)**
- **[wasm-bindgen Guide](https://rustwasm.github.io/wasm-bindgen/)** — Rust ↔ JS interop
- **[ffmpeg.wasm](https://ffmpegwasm.netlify.app/)** — Browser-based audio conversion
- **[ytdl-core](https://github.com/fent/node-ytdl-core)** — YouTube video download

### Binary Format Tools (for debugging GP4 output)

- **[HxD Hex Editor](https://mh-nexus.de/en/hxd/)** (Windows) — Inspect generated .gp4 bytes
- **Guitar Pro** (official app) — Verify files open & playback correctly
- **[TuxGuitar](http://www.tuxguitar.com.ar/)** — Free alternative for validation

### MIDI Reference (for tuning & channels)

- **[MIDI 1.0 Specification](https://www.midi.org/specifications)** — For understanding GP4's MIDI channel layout
- Guitar standard tuning frequencies:
  - High E: 329.63 Hz
  - B: 246.94 Hz
  - G: 196.00 Hz
  - D: 146.83 Hz
  - A: 110.00 Hz
  - Low E: 82.41 Hz

---

## Contributing

This is a personal project. Feel free to use it as a reference for:
- Electron + React + Rust/WASM integration
- Pitch detection algorithms
- Binary file format parsing/writing

---

## License

MIT

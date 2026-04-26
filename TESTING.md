# Testing Guide

## ✅ Prerequisites Verified
- Node.js 25.8.1 ✓
- npm 11.11.0 ✓
- Rust 1.94.0 ✓
- wasm-pack 0.14.0 ✓

---

## Test Level 1: Install Dependencies (5 min)

```bash
cd C:\Users\ZITiS\mp3togp4
npm install
```

**Expected:** All npm packages install without errors. You'll see `electron`, `react`, `ytdl-core`, etc.

**If errors:**
- Clear cache: `npm cache clean --force`
- Delete and reinstall: `rm -rf node_modules package-lock.json && npm install`

---

## Test Level 2: Rust/WASM Compile (2 min)

Test that the Rust code compiles to WASM:

```bash
npm run build:wasm
```

**Expected output:**
```
[INFO]: 🎯  Checking for the Wasm target...
[INFO]: 🌀  Compiling to Wasm...
[INFO]: ✨   Done in X.XXs
[INFO]: 📦   Your wasm pkg is ready
```

**What this verifies:**
- YIN pitch detection algorithm compiles
- GP4 writer compiles
- WASM bindings are correct

**If errors:** Check `src-wasm/lib.rs` and `src-wasm/gp4_writer.rs` for syntax issues.

---

## Test Level 3: Run Rust Unit Tests (1 min)

Tests basic math and format logic without needing audio files:

```bash
cd src-wasm
cargo test --target x86_64-pc-windows-msvc
```

**Expected:** 5 tests pass:
- `test_pitch_detection_low_e` — sample generation works
- `test_frequency_to_fret_math` — pitch→fret math correct
- `test_gp4_version_string` — GP4 format constant
- `test_string_tunings_are_correct` — guitar tuning values
- `test_tempo_estimation_120bpm` — BPM detection math

---

## Test Level 4: Run Desktop App (5-10 min)

Launch the full Electron desktop application:

```bash
npm run dev
```

**Expected:**
1. React dev server starts on `http://localhost:3000`
2. Electron window opens showing the upload page
3. You see the gradient purple UI with "🎸 MP3 to GP4" header
4. Two tabs: "📁 Local File" and "▶️ YouTube URL"

**If app doesn't start:**
- Check terminal output for errors
- Try each command separately: `npm run dev:renderer` then `npm run dev:electron`

---

## Test Level 5: End-to-End File Upload (10 min)

### A. Prepare a test audio file

**Best test file:**
- Simple acoustic guitar riff
- 10-30 seconds long
- Single note at a time (no chords)
- Clear recording (low noise)
- Standard tuning
- Constant tempo

**Quick test option:** Download a free sample from:
- https://freesound.org (search "guitar riff")
- https://archive.org/details/audio

### B. Test flow

1. Launch app: `npm run dev`
2. Click **"📁 Local File"** tab
3. Drag & drop your MP3, OR click "Browse Files"
4. Watch progress bar (should finish in 10-60 seconds)
5. Editor page should appear with detected notes

### C. What to verify

✅ **Notes are detected:** Should see a list of notes with fret/string/time
✅ **Tempo is estimated:** Should show a reasonable BPM (40-300)
✅ **Fretboard visualization:** Active frets highlighted in purple
✅ **Editor works:** Click a note, change fret/string, value updates
✅ **Export works:** Click "📥 Export GP4" → native save dialog appears
✅ **GP4 file valid:** Open the saved .gp4 file in Guitar Pro or TuxGuitar

---

## Test Level 6: YouTube URL (15 min)

1. Launch app
2. Click **"▶️ YouTube URL"** tab
3. Paste a URL, e.g.:
   ```
   https://www.youtube.com/watch?v=VIDEO_ID
   ```
4. Click **"Process Video"**
5. Wait for download + processing (1-3 minutes for typical song)
6. Verify editor appears with notes

**Good test videos** (simple, clean guitar):
- Short acoustic instrumentals
- Single guitar covers
- Tutorial videos with clean audio

---

## Troubleshooting Matrix

| Symptom | Likely Cause | Fix |
|---------|--------------|-----|
| `cannot find module 'ytdl-core'` | npm install incomplete | `npm install` again |
| WASM compile fails | Missing Rust target | `rustup target add wasm32-unknown-unknown` |
| App window is blank | React dev server not running | Wait 10s, or run `npm run dev:renderer` first |
| "Failed to initialize audio processor" | ffmpeg.wasm CDN blocked | Check internet/firewall |
| YouTube download 403 error | YouTube API changes | Update ytdl-core: `npm update ytdl-core` |
| Notes are all fret 0 | Pitch detection picking up silence/noise | Use cleaner audio recording |
| GP4 file won't open in Guitar Pro | Format not fully spec-compliant | Check with hex editor, compare to known good file |

---

## Quick Validation Checklist

Run this in order to verify MVP is working:

- [ ] `npm install` → no errors
- [ ] `npm run build:wasm` → WASM built
- [ ] `cd src-wasm && cargo test` → tests pass
- [ ] `npm run dev` → app launches
- [ ] Upload a simple guitar MP3 → notes detected
- [ ] Click "Export GP4" → save dialog → file saved
- [ ] Open .gp4 in Guitar Pro → file loads (even if basic)

---

## Known Issues to Expect in MVP

These are **expected limitations**, not bugs:

1. **Chords won't detect correctly** — YIN is monophonic
2. **Tempo may be off 2x or 0.5x** — beat subdivision ambiguity
3. **Notes may be ±1 semitone** — pitch detection inherent imprecision
4. **Only basic GP4 features** — no bends, slides, effects yet
5. **YouTube downloads slow** — ytdl-core downloads full video first

---

## Benchmarking (Optional)

Measure processing time for a 3-minute audio file:

```bash
# In the app's browser DevTools Console:
console.time('processing');
# (upload your file, wait for completion)
console.timeEnd('processing');
```

**Target:** <60 seconds for 3-minute audio on modern hardware.

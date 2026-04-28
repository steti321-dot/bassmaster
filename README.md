# 🎸 Bassmaster Workbench

A practice tool for bass &amp; guitar players — built around a Rocksmith-style **note-rain game** with mic scoring, plus a high-precision **tuner**. The Electron desktop build adds an **Audio → GPx transcriber** so you can turn any audio recording into a playable tab.

**Live web app:** https://steti321-dot.github.io/bassmaster/ (Tuner + Game)

---

## A. Learn Bass &amp; Guitar Game (the main event)

Open a Guitar Pro file (`.gp3` / `.gp4` / `.gp5`), pick the track you want to play, then play along on a real instrument while the app listens via your microphone. Notes scroll down per-string columns; the app scores each one on **pitch + timing** as it crosses the hit line.

### Loading tabs

| Source | Where |
|---|---|
| Drag &amp; drop a `.gp` file from disk | always |
| Paste a direct URL to a `.gp` file | always (proxied via Cloudflare Worker if CORS-blocked) |
| Search **gprotab.net** | always (proxied) |
| Recent files | cached locally per browser (IndexedDB) |

Per-song settings (selected track, backing tracks, difficulty, latency offset, etc.) are saved automatically and restored next time you open that file.

### Difficulty + scoring

| Level | Pitch tolerance | Onset window | Late-hit grace |
|---|:---:|:---:|:---:|
| Easy | ±150 ¢ | ±250 ms | full sustain (any time the chip is still active) |
| Medium | ±50 ¢ | ±150 ms | half the sustain |
| Strict | ±25 ¢ | ±75 ms | none — onset window only |

Hit / miss are detected from your mic in real time using a YIN pitch detector + RMS attack tracker. After every hit a small refractory period plus a fresh-attack detection step prevents one sustained note from accidentally scoring multiple identical chips in a row.

For chord groups (multiple notes sharing the same time), pluck **any** member's pitch — the scorer matches against every un-played member and accepts the closest one.

#### Stripe visual states

Each falling chip's stripe gives an at-a-glance cue for what to do:

| State | Fill | Stroke | Glow | Triggered when |
|---|---|---|---|---|
| **Approaching** | 0.32 (subtle) | 2.4 px @ 0.95 opacity | none | the head is still > +timing-window from the hit line |
| **Hittable** | **0.55** (bolder) | **3.4 px @ 1.0 opacity** | **drop-shadow halo** | head is inside ±window — *or* note is still sustaining |
| **Hit** | 0.7 green | 3.4 px green | green burst ring at the hit line | pitch matched within tolerance |
| **Miss** | 0.3 red | 3.4 px red | none | onset + late-grace window passed without a match |

The hittable state uses the active difficulty's timing window, so Easy stripes wake up ~250 ms before onset (and stay bold the whole sustain thanks to late-grace), while Strict only highlights right at the hit line.

### 🧒 Kids Mode

Designed for beginners (or for kids who want to play along to *Seven Nation Army* without learning fret 7). Two simplifications run in sequence on the player track:

1. **Chord reduction** — for any group of simultaneous notes, keep only the lowest pitch. Power chords reduce to root, full chords stay readable as a single melodic line. (v2 will refine this to "5th of the chord" — see `project_kids_mode_chord_policy.md`.)
2. **Position remap inside the 0–5 fret window** — for every note, prefer an alternative `(string, fret)` that produces the same pitch with `fret ≤ 5`, biased toward **staying on the previous note's string**. This dramatically reduces forced string-jumping.

Kids Mode applies to **both display and scoring**, so the player isn't penalized for chord notes that aren't shown.

### 🎯 Training Mode

The song clock **freezes on each upcoming note** until you play the right pitch. Backing tracks pause too. As soon as the mic detects the correct note (RMS spike + pitch match), the clock resumes from where it stopped — so the song progresses at the player's pace, not the tape's.

Pairs cleanly with Kids Mode: kids see one chip per beat, can see/hear the target as long as they need, then trigger the next one with a fresh pluck. Three Es in a row → three plucks.

### Other niceties

- **Note rain** is colored by *pitch class* (12 chromatic colors), not by string — so two notes at different frets on the same string look visibly different. Each chip's fret number sits inside the stripe with a perspective tilt to match the column rails.
- **Side wheel** to the left of the rain shows the current note big and centered, with previous and upcoming notes flowing through. While paused, drag the slider to seek anywhere.
- **Per-instrument tuning** — bass (4-string), guitar (6-string), drop-D, 5-string, 7-string, anything the file declares.
- **Backing synth** runs every other track from the file via a look-ahead Web Audio scheduler — drums, rhythm guitar, vocals, all at once. Mute / volume per track.
- **Latency offset slider** in the gear menu compensates for audio-interface round-trip on mic input.
- **Countdown** before play (4 metronome ticks at the song's tempo) so you can pick up your instrument.
- **Results screen** at song end with accuracy %, hits/misses, best combo, per-string accuracy chart.

---

## B. Tuner

Cyber-themed chromatic tuner with **drop-D presets** for bass and guitar. Pluck a string and:

- The big readout shows the detected pitch (e.g. `A1`, `D2`).
- A needle shows cents-off-target, snapping green when you're within ±5 ¢.
- The closest open-string pill highlights so you know which string you're tuning.

Implementation details:

- 10-sample median ring buffer (~165 ms at 60 fps) smooths YIN's output.
- **Octave-snap** — incoming readings more than 6 semitones from the running median get folded by ±12 semitones, so YIN's classic 2× / 0.5× errors (G1 ↔ G2) don't make the tuner bounce between octaves.
- UI re-renders are throttled to ~80 ms so the needle stops twitching even when the underlying detection runs at full rate.
- Optional **noise suppression** toggle (browser-level RNNoise) for noisy rooms; off by default since it tends to attenuate sustained tonal content.

---

## C. Audio to GPx (Electron-only add-on)

The desktop build ships an **Audio to Notes** tab that runs the Rust transcribe binary plus Spotify's [Basic Pitch](https://github.com/spotify/basic-pitch) ML model to convert any audio recording into a `.gp4` file. Three sources:

- **📁 File** — drop or pick any audio (MP3 / M4A / WAV / FLAC / OGG / MP4 audio).
- **▶️ YouTube** — paste a URL, `yt-dlp` downloads the audio locally and pipes it into transcription.
- **🎤 Mic** — record directly through your mic (Float32 → 16-bit WAV) and transcribe.

Three detection modes:

- ⭐ **AI (Basic Pitch)** — best quality, ~2.5× realtime. Recommended.
- **Mono (YIN)** — fastest, single-note tracker. Best for clean melodies.
- **Chords (FFT)** — polyphonic; can pick up harmonics.

Plus a **Suppress drums (HPSS)** pre-filter for percussion-heavy material.

Output is a regular `.gp4` you can edit in the built-in fretboard editor or export and load straight into the **Learn Game** tab. **All audio processing happens locally** — no data leaves the machine.

> **Why not in the web build?** The transcriber needs a native Rust binary and `yt-dlp.exe`, neither of which run in a browser. Hosting the pipeline server-side would mean a paid backend + lose the local-only privacy guarantee. So the web app is play/practice; the Electron app is the production studio.

---

## Building &amp; running

### Desktop (Electron, full feature set)

```bash
npm install
npm run dev          # spins up React + Electron
```

```bash
npm run build        # produces an Electron-ready bundle
```

Requires Rust toolchain for the `transcribe` binary (`cargo build --release` in `cli/`) and `yt-dlp` (auto-downloaded on `npm install` via `scripts/setup-ytdlp.mjs`).

### Web (Tuner + Game, deployed to GitHub Pages)

```bash
npm run build:web    # produces ./build for static hosting
```

Pushed to `main`, the GH Action at `.github/workflows/deploy-pages.yml` builds and deploys to GH Pages automatically.

### Cloudflare Worker (CORS proxy used by the web build)

```bash
cd worker
npm install
CLOUDFLARE_API_TOKEN=... npx wrangler deploy
```

Deploys ~50 lines of code that re-implement the Electron main process's `gprotab-search` / `gprotab-download` handlers as HTTP endpoints with permissive CORS — letting the static web app fetch tabs from third-party hosts.

---

## Tech stack

- **React + TypeScript** — UI for both Electron and web.
- **Web Audio API** — note rain audio scheduling, mic input, tuner detection.
- **[@coderline/alphatab](https://github.com/CoderLine/alphaTab)** — GP3/GP4/GP5/GPX parsing.
- **Electron 27** — desktop shell (renderer + main).
- **Rust + WASM** — transcribe binary &amp; pitch math (Electron only).
- **Spotify Basic Pitch** — ML transcription (Electron only).
- **Cloudflare Workers** — static-site CORS proxy.

---

## Status / roadmap

Shipped (v1):

- Tuner with drop-D presets, octave-snap stabilization
- Note-rain game with chord-color stripes, perspective tilt, side wheel
- Kids Mode (chord reduction + 0–5 fret window + same-string smoothing)
- Training Mode (clock freezes per note until played)
- gprotab.net + paste-URL + drag-drop file inputs
- Audio-to-Notes desktop pipeline (Mic / File / YouTube)
- GH Pages deploy

Tracked for future iterations (see `~/.claude/projects/.../memory/`):

- Power-chord vs full-chord refinement (root vs 5th instead of plain "lowest pitch")
- Vite migration off the deprecated CRA toolchain
- More aggressive string-smoothing in Kids Mode v2

---

## License

MIT

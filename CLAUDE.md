# Bassmaster Workbench — Claude session primer

Concise context for new sessions. Skim once at start; deeper details live in `README.md` and the user's `~/.claude/projects/C--Users-ZITiS-mp3togp4/memory/`.

## What this project is

Practice tool for bass &amp; guitar built around a Rocksmith-style note-rain game with mic scoring. **Two distribution targets, one source tree:**

- **Electron desktop app** — full feature set incl. **Audio-to-Notes** transcription (Rust binary + yt-dlp + Spotify Basic Pitch).
- **Static web app on GitHub Pages** — Tuner + Learn Game only (Audio-to-Notes excluded; needs native deps).

Live web URL: **https://steti321-dot.github.io/bassmaster/** · Repo: **https://github.com/steti321-dot/bassmaster**

CORS proxy for the web build: **https://guitar-workbench-proxy.bassmaster.workers.dev** (Cloudflare Worker, code in `worker/`, free tier).

## Repo layout

```
src/
  electron/          Electron main + preload (built only by `tsconfig.electron.json`; never imported from renderer — only via `window.electronAPI`)
  tabs/
    Music2Notes.tsx  Audio→GP4 (Electron-only; web build hides this tab)
    Tuner.tsx        Cyber tuner, drop-D presets, octave-snap stabilisation
    LearnGuitarGame.tsx  Game orchestrator (state machine, rAF loop, mic scoring)
  game/
    AlphatabReader.ts    GP3/4/5 parsing via @coderline/alphatab
    BackingSynth.ts      Look-ahead Web Audio scheduler (LOOKAHEAD_SEC=2, 250ms tick)
    Instrument.ts        BASS / GUITAR profiles, buildProfileFromTuning(), pitchClassColor()
    MicCapture.ts        getUserMedia + AnalyserNode + monitor gain
    PitchDetectorJS.ts   YIN (monophonic) — see roadmap for polyphonic next-step
    simplify.ts          Kids-Mode chord reduction + 0–5 fret remap with same-string smoothing
    songSettings.ts      Per-song settings persistence in localStorage
    recentFiles.ts       IndexedDB-backed recent file cache (browser-local, no server)
    demoSongs.ts         Built-in Quick Start songs — Twinkle, Smoke (extracted from gp4), Four Chords, Queen (extracted from gp3)
    components/
      NoteRain.tsx           SVG note-rain canvas (chips, stripes, hit-burst, top-anchored labels)
      SidePanel.tsx          Compact circular-chip wheel (past/current/future)
      FretboardMini.tsx      12-fret strip below the rain showing the upcoming chord
      HUD.tsx                Top bar with score + ⚙ Options modal (Speed/Difficulty/Kids/Training)
      FilePicker.tsx         Search bar on top + Demo/Recent/Files/Web tabs
      CountdownOverlay.tsx   3-2-1-GO! before play
      ResultsScreen.tsx      End-of-song stats
  services/
    gprotabClient.ts     Search/download — runtime detects electronAPI vs proxy fetch
    fetchGpUrl.ts        Paste-URL with proxy fallback + magic-byte sanity check
  pages/Upload.tsx       Tab 1 file picker (Electron only; mic recorder included)
worker/                  Cloudflare Worker — /proxy + /gprotab/{search,download}
scripts/extract-gp-track.mjs  Tool for adding new built-in songs from any GP file
.github/workflows/deploy-pages.yml   GH Action: build:web → push to gh-pages
```

## Build &amp; deploy

```bash
npm run dev            # Electron dev (Vite renderer on :3000 + Electron window)
npm run build          # Electron production
npm run build:web      # static SPA for GH Pages (sets REACT_APP_BUILD_TARGET=web)
npm run deploy:worker  # Cloudflare Worker (cd worker && wrangler deploy)
```

GH Pages auto-deploys on push to `main`. Web build excludes `Music2Notes` via `IS_WEB_BUILD = process.env.REACT_APP_BUILD_TARGET === 'web'` in `App.tsx` (lazy import + tab hidden).

**Vite, not CRA** — `vite.config.ts` plus `@coderline/alphatab-vite` replaces the old `react-scripts` + `craco` + `@coderline/alphatab-webpack` stack (migrated 2026-04). The `define` block in `vite.config.ts` keeps `process.env.REACT_APP_*` working verbatim, so source code didn't have to change. `base` is derived per build target: `'/bassmaster/'` for the web build, `'./'` for Electron. `npm install` no longer needs `--legacy-peer-deps`. Dev server boots in ~350 ms; production build in ~8 s (was ~60 s).

## Active conventions

- **String indexing**: `0` = highest-pitched string (high e for guitar, G for bass), `numStrings-1` = lowest. NoteRain mirrors this for display so the *lowest* pitch sits on the **left** column (Rocksmith convention).
- **Chord-policy** (Kids Mode): power chord (root + 5th) → root; full chord with perfect 5th → 5th (closest octave); diminished/sus/no-5th → root fallback. See `simplify.ts:pickFromChord` and `project_kids_mode_chord_policy.md`.
- **Same-string smoothing**: position remap prefers the previous output note's string; +100 cost penalty for string changes. `simplify.ts` step 2.
- **Difficulty**: Easy ±150 ¢ / ±250 ms onset / full sustain late-grace. Medium ±50 ¢ / ±150 ms / half sustain. Strict ±25 ¢ / ±75 ms / none.
- **Stripe states**: approaching (subtle) → hittable (bold + glow when head ∈ ±window OR sustain still active) → hit (green burst) / miss (red dim).
- **Note frequencies** in `GameNote` are computed against the file's *actual tuning* (drop-D, 5-string bass, etc.) via `buildProfileFromTuning`.
- **Look-ahead synth scheduler**: do NOT pre-schedule entire songs into Web Audio — chokes after a few thousand events. Use `BackingSynth.ts`'s 250 ms-tick lookahead.
- **i18n is mandatory**: Every user-visible string must use `t('namespace:key')` — no hardcoded English in JSX. Locale files live in `src/locales/[lang]/[namespace].json` (en, de, fr, es, it, pt). When adding or changing any UI text, update **all 6** locale files. Use `Trans` from react-i18next for strings that contain HTML tags.

## What NOT to do

- **No Python anywhere** in the project stack. Rust / Node / C++ / WASM only. Don't even use pip for tooling. (See `feedback_no_python.md`.)
- **Don't commit without explicit user approval.** When the user asks for a change, build + verify first; only commit when they say so or it's clearly the natural end of an iteration.
- **Don't bump the version (`npm version …`) or push to upstream automatically.** Both are user-only actions — even when iterating quickly, wait for an explicit "bump and deploy" / "push" / "deploy" instruction. Auto-mode iteration must stay local-only until the user signs off.
- **Don't push if the working copy has secrets**. We've already had one Cloudflare API token leak via `.claude/settings.local.json`; it's now gitignored. Watch for token-shaped strings before staging.
- **Don't pre-schedule full-song audio**. See above — use the look-ahead pattern.

## Open roadmap (priority-ish order)

1. **Polyphonic chord recognition** — biggest UX gap. Current YIN is monophonic, so strummed chords need N plucks to score. Candidate: FFT peak-picking, or run Spotify Basic Pitch incrementally.
2. **Strum vs pick discrimination** — RMS-envelope shape analysis so a strum can score a whole chord at once (vs. accidentally registering only one tone).
3. Session replays, shareable song URLs, opt-in cloud song library.
4. More chord-policy refinements (sus → suspended tone, V7→I leading-tone, jazz extensions).

## Memory cross-refs (user-level)

- `feedback_no_python.md` — language stack rule
- `project_bun_available.md` — pass `--js-runtimes bun` to yt-dlp to silence warnings
- `project_kids_mode_chord_policy.md` — ✅ shipped, current power/full/no-5th policy
- `project_kids_mode_string_smoothing.md` — ✅ shipped (Kids Mode v2)
- `project_vite_migration.md` — ✅ shipped (Vite 7 + @coderline/alphatab-vite, dropped --legacy-peer-deps)

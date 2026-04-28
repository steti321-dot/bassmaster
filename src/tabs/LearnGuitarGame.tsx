import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './LearnGuitarGame.css';
import FilePicker from '../game/components/FilePicker';
import TrackPicker from '../game/components/TrackPicker';
import type { PickedFile } from '../game/components/FilePicker';
import NoteRain from '../game/components/NoteRain';
import SidePanel from '../game/components/SidePanel';
import HUD from '../game/components/HUD';
import FretboardMini from '../game/components/FretboardMini';
import { getInstrument, buildProfileFromTuning } from '../game/Instrument';
import { DIFFICULTIES, INITIAL_SCORE } from '../game/types';
import type { Song, Difficulty, ScoreState } from '../game/types';
import { BackingSynth } from '../game/BackingSynth';
import { MicCapture } from '../game/MicCapture';
import { detectPitch, centsBetween } from '../game/PitchDetectorJS';
import { detectPolyphonicPitches } from '../game/PolyphonicDetectorJS';
import { loadSettings, saveSettings } from '../game/songSettings';
import { simplifyForKids } from '../game/simplify';
import CountdownOverlay from '../game/components/CountdownOverlay';
import ResultsScreen from '../game/components/ResultsScreen';
import SettingsPanel from '../game/components/SettingsPanel';
import CalibrationWizard from '../game/components/CalibrationWizard';
import { loadCalibration } from '../game/calibration';
import type { CalibrationData } from '../game/calibration';
import type { EmbeddedAudioTrack } from '../game/extractGpAudio';

type GamePhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'results';

const NOTE_NAMES_DBG = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
function freqToNoteName(hz: number): string {
  const midi = Math.round(69 + 12 * Math.log2(hz / 440));
  const oct  = Math.floor(midi / 12) - 1;
  return NOTE_NAMES_DBG[((midi % 12) + 12) % 12] + oct;
}

/**
 * Tab 2: Learn Guitar Game.
 *
 * Phase 1: Static skeleton — renders a chosen song's notes scrolling down,
 * shows upcoming notes by string/fret, has play/pause controls. No mic/scoring yet.
 */
export default function LearnGuitarGame() {
  const { t } = useTranslation(['game', 'common']);
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const isPlaying = gamePhase === 'playing';
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latencyOffsetMs, setLatencyOffsetMs] = useState(() => loadCalibration()?.latencyOffsetMs ?? 0);
  const [customPitchToleranceCents, setCustomPitchToleranceCents] = useState<number | undefined>(undefined);
  const [kidsMode, setKidsMode] = useState(false);
  const [waitMode, setWaitMode] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [backingMuted, setBackingMuted] = useState(false);
  const [backingVolume, setBackingVolume] = useState(0.55);
  const [enabledBacking, setEnabledBacking] = useState<Set<number>>(new Set());
  const [score, setScore] = useState<ScoreState>(INITIAL_SCORE);
  const [calibration, setCalibration] = useState<CalibrationData | null>(() => loadCalibration());
  const [calOpen, setCalOpen] = useState(false);
  const [micEnabled, setMicEnabled] = useState(true);
  const [micStatus, setMicStatus] = useState<'idle' | 'requesting' | 'live' | 'denied'>('idle');
  // Monitor (hear yourself through speakers) defaults to 0 — using speakers
  // without headphones causes mic-feedback. User must explicitly raise it.
  const [monitorVolume, setMonitorVolume] = useState(0);
  const [monitorMuted, setMonitorMuted] = useState(false);
  const [noiseSuppress, setNoiseSuppress] = useState(false);
  const [noteResults, setNoteResults] = useState<Map<number, 'hit' | 'miss'>>(new Map());
  // Wall-clock timestamp (performance.now()) of when each hit was scored —
  // used by NoteRain to render a brief expanding-ring burst on each fresh
  // hit. Re-uses the same map as a ref to avoid extra re-renders.
  const hitAtRef = useRef<Map<number, number>>(new Map());

  // Embedded audio from GP7/8 BCFS container — present when the user chose
  // "Use embedded audio as backing" in TrackPicker. Played via HTMLAudioElement
  // in sync with the game clock; oscillator backing is skipped for these songs.
  const [embeddedAudio, setEmbeddedAudio] = useState<EmbeddedAudioTrack[] | undefined>(undefined);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Mic debug overlay — updated at ~25 Hz in the scoring loop.
  interface MicDebugState {
    rms: number;
    gateOpen: boolean;
    pitches: Array<{ freq: number; note: string; conf: number }>;
  }
  const [micDebug, setMicDebug] = useState<MicDebugState | null>(null);

  // Refs for the realtime scoring loop (avoid stale closures)
  const scoreRef = useRef<ScoreState>(INITIAL_SCORE);
  scoreRef.current = score;
  const noteResultsRef = useRef<Map<number, 'hit' | 'miss'>>(noteResults);
  noteResultsRef.current = noteResults;
  const nextEvalIdxRef = useRef<number>(0);
  const difficultyRef = useRef<Difficulty>(difficulty);
  difficultyRef.current = difficulty;
  const latencyOffsetRef = useRef<number>(0);
  latencyOffsetRef.current = latencyOffsetMs;
  const customToleranceRef = useRef<number | undefined>(undefined);
  customToleranceRef.current = customPitchToleranceCents;
  const waitModeRef = useRef<boolean>(false);
  waitModeRef.current = waitMode;
  // Tracks whether the rAF loop is currently frozen waiting for the player.
  // We mirror it in state for visual cues (the overlay), but the loop itself
  // reads the ref to avoid stale closures.
  const isWaitingRef = useRef<boolean>(false);
  const micCaptureRef = useRef<MicCapture | null>(null);
  // Throttle pitch detection to ~25 Hz so we don't burn CPU
  const lastDetectAtRef = useRef<number>(0);
  // After a hit we require a brief silence (RMS drop) before the next note
  // can be scored. Without this, a sustained note can tick off several
  // identical upcoming notes in a row — especially noticeable in wait mode.
  // We use a RELATIVE threshold (current RMS < 40% of post-hit peak) so the
  // gate clears even when the room/instrument noise floor is high or the
  // note has long sustain — what we actually care about is the pluck-decay
  // shape, not absolute silence.
  const requireSilenceRef = useRef<boolean>(false);
  const peakRmsSinceHitRef = useRef<number>(0);
  const calibrationRef = useRef<CalibrationData | null>(null);
  calibrationRef.current = calibration;
  // Log throttle — only print a detection-frame summary every 200 ms so the
  // console stays readable. Scoring events (hit/miss) always log immediately.
  const lastLogAtRef = useRef<number>(0);
  // Smoothed RMS used as a "recent loudness" baseline to detect fresh pluck
  // attacks. When current RMS jumps well above this baseline, we treat it
  // as a new pluck even if the previous note is still ringing.
  const recentRmsRef = useRef<number>(0);
  // Hard refractory after each hit — pitch detection is suppressed for
  // this many ms regardless of gate state. Prevents fluctuations in a
  // long-sustain note's RMS from registering as new attacks immediately
  // after the hit was scored.
  const lastHitAtRef = useRef<number>(0);
  const REFRACTORY_MS = 200;
  const embeddedAudioRef = useRef<EmbeddedAudioTrack[] | undefined>(undefined);
  embeddedAudioRef.current = embeddedAudio;

  // Initialize enabled-backing set whenever a new song loads.
  // Also restore per-song preferences (difficulty, speed, audio levels) from
  // localStorage if we've seen this song before.
  useEffect(() => {
    if (!song) {
      setEnabledBacking(new Set());
      return;
    }
    setEnabledBacking(new Set(song.backingEnabled));

    if (song.source) {
      const saved = loadSettings(song.source);
      if (saved) {
        setDifficulty(saved.difficulty);
        setPlaybackRate(saved.playbackRate);
        setBackingVolume(saved.backingVolume);
        setBackingMuted(saved.backingMuted);
        setMonitorVolume(saved.monitorVolume);
        setMonitorMuted(saved.monitorMuted);
        setNoiseSuppress(saved.noiseSuppress);
        setLatencyOffsetMs(saved.latencyOffsetMs ?? 0);
        setCustomPitchToleranceCents(saved.customPitchToleranceCents);
        setKidsMode(saved.kidsMode ?? false);
        setWaitMode(saved.waitMode ?? false);
      } else {
        // Fresh session — reset overrides to defaults
        setLatencyOffsetMs(0);
        setCustomPitchToleranceCents(undefined);
        setKidsMode(false);
        setWaitMode(false);
      }
    }
  }, [song]);

  // Persist per-song settings whenever a relevant field changes
  useEffect(() => {
    if (!song?.source) return;
    saveSettings(song.source, {
      playerTrackIdx: song.playerTrackIndex,
      backingSet: Array.from(enabledBacking),
      difficulty,
      playbackRate,
      backingVolume,
      backingMuted,
      monitorVolume,
      monitorMuted,
      noiseSuppress,
      latencyOffsetMs,
      customPitchToleranceCents,
      kidsMode,
      waitMode,
    });
  }, [
    song,
    enabledBacking,
    difficulty,
    playbackRate,
    backingVolume,
    backingMuted,
    monitorVolume,
    monitorMuted,
    noiseSuppress,
    latencyOffsetMs,
    customPitchToleranceCents,
    kidsMode,
    waitMode,
  ]);

  // Build the list of tracks to feed into the synth based on `enabledBacking`
  const buildBackingTracks = (s: Song, enabled: Set<number>) =>
    s.tracks
      .filter((t) => enabled.has(t.index) && t.notes.length > 0)
      .map((t) => ({ notes: t.notes, instrument: t.instrument, isDrums: t.isDrums }));

  // Start / stop the embedded HTMLAudioElement synced to the game clock.
  // Volume is kept in sync by a separate effect; no need to set it here.
  const startAudio = (fromMs: number, rate: number) => {
    const el = audioElRef.current;
    if (!el) return;
    el.playbackRate = rate;
    el.currentTime = fromMs / 1000;
    el.play().catch(() => {/* autoplay blocked — user interaction required */});
  };

  const stopAudio = () => audioElRef.current?.pause();

  const startRefMs = useRef<number>(0);
  const offsetRefMs = useRef<number>(0);
  const animationRef = useRef<number | null>(null);
  const playbackRateRef = useRef<number>(1.0);
  playbackRateRef.current = playbackRate;
  const synthRef = useRef<BackingSynth>(new BackingSynth());

  // Keep synth's volume / mute settings in sync with state
  useEffect(() => {
    synthRef.current.setVolume(backingVolume);
  }, [backingVolume]);
  useEffect(() => {
    synthRef.current.setMuted(backingMuted);
  }, [backingMuted]);

  // Tear down the audio context when the tab unmounts
  useEffect(() => {
    const synth = synthRef.current;
    return () => synth.dispose();
  }, []);

  // Set up / tear down the HTMLAudioElement when embedded audio changes.
  useEffect(() => {
    const prev = audioElRef.current;
    if (prev) { prev.pause(); prev.src = ''; audioElRef.current = null; }

    if (embeddedAudio && embeddedAudio.length > 0) {
      const el = new Audio(embeddedAudio[0].url);
      el.preload = 'auto';
      audioElRef.current = el;
    }
  }, [embeddedAudio]);

  // Sync HTMLAudioElement volume with the backing volume control.
  useEffect(() => {
    const el = audioElRef.current;
    if (!el) return;
    el.volume = backingMuted ? 0 : backingVolume;
  }, [backingVolume, backingMuted]);

  // Kids mode: derive a simplified note stream (chord reduction + 0–5 fret
  // remap) from the player track. The same array drives display AND scoring,
  // so the user is only asked to play what they see.
  const displayedNotes = useMemo(() => {
    if (!song) return [] as Song['notes'];
    if (!kidsMode) return song.notes;
    const tuning = song.tracks[song.playerTrackIndex]?.tuning ?? [];
    return simplifyForKids(song.notes, tuning);
  }, [song, kidsMode]);

  // Reset scoring progress when the displayed-notes array identity changes
  // (e.g., toggling Kids Mode). Prevents stale indices into the old array.
  useEffect(() => {
    nextEvalIdxRef.current = 0;
    setNoteResults(new Map());
    hitAtRef.current = new Map();
    setScore(INITIAL_SCORE);
  }, [displayedNotes]);

  // How long a chip takes to travel from horizon to hit line.
  // Smaller value = bigger pixel-distance between consecutive chips (less crowded).
  // Trade-off: less song-time visible at once. The SidePanel covers the "look further
  // ahead" need, so we keep this short and let chips breathe vertically.
  const fallDurationSec = 2.0;

  // Game loop — drives currentTimeMs from rAF, scaled by playback rate, and runs scoring
  useEffect(() => {
    if (!isPlaying || !song) return;
    startRefMs.current = performance.now() - offsetRefMs.current / playbackRateRef.current;

    const playerTuning = song.tracks[song.playerTrackIndex]?.tuning ?? [];
    const profile = playerTuning.length > 0
      ? buildProfileFromTuning(playerTuning, song.instrument)
      : getInstrument(song.instrument);

    const tick = () => {
      const now = performance.now();
      let elapsed = (now - startRefMs.current) * playbackRateRef.current;

      // Wait-mode gate: when on, the song clock freezes at the next un-played
      // note's onset until the player produces the right pitch. We clamp the
      // visible clock there and stop the synth so the kid hears silence —
      // signal that the app is waiting for them.
      if (waitModeRef.current) {
        const idx = nextEvalIdxRef.current;
        const target = displayedNotes[idx];
        if (target && !noteResultsRef.current.has(idx) && elapsed >= target.time) {
          if (!isWaitingRef.current) {
            isWaitingRef.current = true;
            setIsWaiting(true);
            synthRef.current.stop();
            stopAudio();
          }
          elapsed = target.time;
        } else if (isWaitingRef.current) {
          // Just exited the gate (note hit, or wait mode toggled off mid-wait).
          // Re-anchor the real-time clock and resume audio from here.
          isWaitingRef.current = false;
          setIsWaiting(false);
          startRefMs.current = performance.now() - elapsed / playbackRateRef.current;
          if (song) {
            if (embeddedAudioRef.current) {
              startAudio(elapsed, playbackRateRef.current);
            } else {
              synthRef.current.start(
                buildBackingTracks(song, enabledBacking),
                elapsed,
                playbackRateRef.current,
              );
            }
          }
        }
      } else if (isWaitingRef.current) {
        // Wait mode toggled off while frozen — resume immediately.
        isWaitingRef.current = false;
        setIsWaiting(false);
        startRefMs.current = performance.now() - elapsed / playbackRateRef.current;
        if (song) {
          if (embeddedAudioRef.current) {
            startAudio(elapsed, playbackRateRef.current);
          } else {
            synthRef.current.start(
              buildBackingTracks(song, enabledBacking),
              elapsed,
              playbackRateRef.current,
            );
          }
        }
      }

      setCurrentTimeMs(elapsed);

      // Stop when we're 2 seconds past the last note → show results
      const lastNoteEnd = displayedNotes.length > 0
        ? Math.max(...displayedNotes.map((n) => n.time + n.duration))
        : 0;
      if (elapsed > lastNoteEnd + 2000) {
        synthRef.current.stop();
        stopAudio();
        setGamePhase('results');
        return;
      }

      // Scoring — only run pitch detection at ~25 Hz to keep CPU happy
      if (now - lastDetectAtRef.current > 40 && micCaptureRef.current?.isStarted()) {
        lastDetectAtRef.current = now;
        const cfg = DIFFICULTIES[difficultyRef.current];
        // Pitch tolerance: user override beats difficulty preset
        const pitchTol = customToleranceRef.current ?? cfg.pitchToleranceCents;
        // Latency offset shifts effective elapsed: positive value means user's
        // audio arrives late, so we treat the song clock as further along.
        const effectiveElapsed = elapsed - latencyOffsetRef.current;

        const snap = micCaptureRef.current.snapshot();
        // Use calibrated thresholds when available; fall back to conservative defaults.
        const cal = calibrationRef.current;
        const RMS_GATE    = cal?.rmsGate    ?? 0.005;
        const ATTACK_FLOOR = cal?.attackFloor ?? 0.008;
        const inWait = isWaitingRef.current;
        const ATTACK_RATIO = inWait ? 1.2 : 1.5;
        if (snap) {
          const prevBaseline = recentRmsRef.current;
          if (requireSilenceRef.current) {
            peakRmsSinceHitRef.current = Math.max(peakRmsSinceHitRef.current, snap.rms);
            const newAttack =
              prevBaseline > 0.001 &&
              snap.rms > prevBaseline * ATTACK_RATIO &&
              snap.rms > ATTACK_FLOOR;
            // Training Mode safety net: if we've been waiting for more
            // than 1.2 s without detecting an attack, force-clear the
            // gate. Either the user is plucking softly enough that the
            // baseline tracks every pluck, or the previous note has
            // decayed below the EMA — either way, blocking detection
            // any longer just frustrates the player.
            const stuckTooLong =
              inWait && now - lastHitAtRef.current > 1200;
            if (newAttack || stuckTooLong) {
              requireSilenceRef.current = false;
              peakRmsSinceHitRef.current = snap.rms;
              lastHitAtRef.current = 0;
            }
          }
          // EMA over ~4 frames — baseline lags the current RMS, so a sharp
          // re-pluck spike still beats it.
          recentRmsRef.current = prevBaseline * 0.75 + snap.rms * 0.25;
        }
        let detectedPitches: Array<{ frequency: number; confidence: number }> = [];
        const inRefractory = now - lastHitAtRef.current < REFRACTORY_MS;
        if (
          snap &&
          snap.rms > RMS_GATE &&
          !requireSilenceRef.current &&
          !inRefractory
        ) {
          detectedPitches = detectPolyphonicPitches(
            snap.samples,
            snap.sampleRate,
            profile.minPitchHz,
            profile.maxPitchHz,
            6
          );
        }

        // Throttled detection log (~5 Hz) — open browser console to read.
        if (now - lastLogAtRef.current > 200) {
          lastLogAtRef.current = now;
          const gateStr  = requireSilenceRef.current ? 'GATE:closed' : 'GATE:open';
          const rmsStr   = `RMS:${((snap?.rms ?? 0) * 100).toFixed(1)}%`;
          const refStr   = inRefractory ? ' REFRACTORY' : '';
          const pitchStr = detectedPitches.length === 0
            ? 'no-pitch'
            : detectedPitches.map(p =>
                `${freqToNoteName(p.frequency)}(${p.frequency.toFixed(0)}Hz,${(p.confidence * 100).toFixed(0)}%)`
              ).join(' ');
          console.log(`[MIC] ${gateStr} ${rmsStr}${refStr} → ${pitchStr}`);
        }

        // Walk forward over upcoming notes, scoring within timing window
        const results = noteResultsRef.current;
        let resultsChanged = false;
        let scoreChanged = false;
        const newScore = { ...scoreRef.current };

        const loopStartIdx = nextEvalIdxRef.current;
        for (let i = loopStartIdx; i < displayedNotes.length; i++) {
          // Wait-mode invariant: never look past the frozen target on the
          // same frame — the clock is clamped to its onset, so subsequent
          // notes would all be reported as in-window which is wrong.
          if (isWaitingRef.current && i > loopStartIdx) break;

          const n = displayedNotes[i];
          const dt = effectiveElapsed - n.time;
          if (dt < -cfg.timingWindowMs) break; // future note — wait
          if (results.has(i)) {
            if (i === nextEvalIdxRef.current) nextEvalIdxRef.current = i + 1;
            continue;
          }

          // Late-hit grace: while the chip's stripe is still visibly active
          // above the hit line (i.e. we're still inside the note's sustain
          // duration), accept a hit even past the strict onset-timing
          // window. Difficulty controls how generous:
          //   easy   → full sustain hittable (any time during the note)
          //   medium → half the sustain
          //   strict → no late grace (just the onset timing window)
          const lateGraceFactor =
            difficultyRef.current === 'easy' ? 1 :
            difficultyRef.current === 'medium' ? 0.5 : 0;
          const lateLimit = cfg.timingWindowMs + lateGraceFactor * n.duration;
          if (dt > lateLimit) {
            // Window passed without detection → miss
            results.set(i, 'miss');
            resultsChanged = true;
            newScore.misses += 1;
            newScore.combo = 0;
            scoreChanged = true;
            nextEvalIdxRef.current = i + 1;
            // The gate was protecting this note; it's resolved now, so open
            // up immediately so the next note's pluck is detectable.
            requireSilenceRef.current = false;
            console.log(`[MISS] note#${i} ${freqToNoteName(n.frequency)}(${n.frequency.toFixed(0)}Hz) dt=${dt.toFixed(0)}ms lateLimit=${lateLimit.toFixed(0)}ms`);
            continue;
          }

          // Inside the window: did we detect the right pitch(es)? For chords
          // (multiple un-played notes sharing the same time), accept ANY
          // member's pitch — the user can pluck any string of the chord
          // and we score the matching one. With polyphonic detection, we can
          // now handle multiple simultaneous pitches (e.g., a strummed triad).
          // For each detected pitch, find the best matching chord member.
          if (detectedPitches.length > 0) {
            let anyHitThisFrame = false;
            for (const detectedPitch of detectedPitches) {
              const detectedFreq = detectedPitch.frequency;
              let bestMatchIdx = -1;
              let bestMatchCents = pitchTol;
              for (
                let j = i;
                j < displayedNotes.length && displayedNotes[j].time === n.time;
                j++
              ) {
                if (results.has(j)) continue;
                const cj = Math.abs(centsBetween(detectedFreq, displayedNotes[j].frequency));
                if (cj < bestMatchCents) {
                  bestMatchCents = cj;
                  bestMatchIdx = j;
                }
              }
              if (bestMatchIdx >= 0) {
                const hitIdx = bestMatchIdx;
                results.set(hitIdx, 'hit');
                resultsChanged = true;
                newScore.hits += 1;
                newScore.combo += 1;
                newScore.bestCombo = Math.max(newScore.bestCombo, newScore.combo);
                newScore.score += 100 + 10 * newScore.combo;
                scoreChanged = true;
                hitAtRef.current.set(hitIdx, now);
                anyHitThisFrame = true;
                const hn = displayedNotes[hitIdx];
                console.log(`[HIT]  note#${hitIdx} ${freqToNoteName(hn.frequency)}(${hn.frequency.toFixed(0)}Hz) detected@${detectedFreq.toFixed(0)}Hz ±${bestMatchCents.toFixed(0)}¢`);
              }
            }
            // Attack detection/refractory applies only to the first pitch
            // in this frame to avoid multiple triggers from a single strum.
            if (anyHitThisFrame && !requireSilenceRef.current) {
              // Lock the gate AND start the refractory timer. Anchor the
              // baselines at the hit's RMS so the very next frame compares
              // sustained ringing against this level (not pre-hit silence).
              requireSilenceRef.current = true;
              peakRmsSinceHitRef.current = snap?.rms ?? 0;
              recentRmsRef.current = snap?.rms ?? 0;
              lastHitAtRef.current = now;
            }
          }

          // Partial-chord forgiveness: if enough notes of this chord have
          // already been scored (across any prior or current frame), forgive
          // the remaining ones so a partial strum doesn't generate misses.
          //   Easy   → 1 detected hit forgives the rest
          //   Medium → 2 detected hits forgive the rest
          //   Strict → no forgiveness
          const forgiveMin =
            difficultyRef.current === 'easy' ? 1 :
            difficultyRef.current === 'medium' ? 2 : Infinity;
          if (forgiveMin < Infinity) {
            // Scan backward to find the first chord member at n.time
            // (earlier members may have been scored in previous frames).
            let chordStart = i;
            while (chordStart > 0 && displayedNotes[chordStart - 1].time === n.time) chordStart--;
            // Scan forward to find the last chord member.
            let chordEnd = i;
            while (chordEnd + 1 < displayedNotes.length && displayedNotes[chordEnd + 1].time === n.time) chordEnd++;

            const chordSize = chordEnd - chordStart + 1;
            if (chordSize > 1) {
              let chordHits = 0;
              for (let j = chordStart; j <= chordEnd; j++) {
                if (results.get(j) === 'hit') chordHits++;
              }
              if (chordHits >= forgiveMin) {
                for (let j = i; j <= chordEnd; j++) {
                  if (!results.has(j)) {
                    results.set(j, 'hit');
                    resultsChanged = true;
                    newScore.hits += 1;
                    newScore.combo += 1;
                    newScore.bestCombo = Math.max(newScore.bestCombo, newScore.combo);
                    newScore.score += 100 + 10 * newScore.combo;
                    scoreChanged = true;
                    hitAtRef.current.set(j, now);
                  }
                }
              }
            }
          }

          // Advance nextEvalIdxRef past contiguously-scored chord members
          // (covers both directly-detected hits and forgiven notes above).
          while (
            nextEvalIdxRef.current < displayedNotes.length &&
            results.has(nextEvalIdxRef.current)
          ) {
            nextEvalIdxRef.current += 1;
          }
        }

        if (resultsChanged) {
          setNoteResults(new Map(results));
        }
        if (scoreChanged) {
          setScore(newScore);
        }

        // Mic debug overlay — update every detection tick (~25 Hz).
        setMicDebug({
          rms: snap?.rms ?? 0,
          gateOpen: !requireSilenceRef.current,
          pitches: detectedPitches.slice(0, 6).map(p => ({
            freq: p.frequency,
            note: freqToNoteName(p.frequency),
            conf: p.confidence,
          })),
        });
      }

      animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current);
        animationRef.current = null;
      }
    };
  }, [isPlaying, song]);

  // Pressing ▶ from idle/results triggers the pre-roll countdown.
  // Resuming from paused goes straight to playing (no countdown).
  const handlePlay = async () => {
    if (!song) return;
    const ctx = synthRef.current.warmUp();

    // Lazy-start the mic the first time the user presses Play (asks permission once)
    if (micEnabled && (!micCaptureRef.current || !micCaptureRef.current.isStarted())) {
      try {
        setMicStatus('requesting');
        if (!micCaptureRef.current) micCaptureRef.current = new MicCapture(ctx);
        micCaptureRef.current.setMonitorVolume(monitorVolume);
        micCaptureRef.current.setMonitorMuted(monitorMuted);
        await micCaptureRef.current.start({ noiseSuppression: noiseSuppress });
        setMicStatus('live');
      } catch (err) {
        console.warn('[mic] permission denied or device unavailable:', err);
        setMicStatus('denied');
      }
    }

    if (gamePhase === 'paused') {
      // Resume from where we left off — no countdown needed
      if (embeddedAudio) {
        startAudio(currentTimeMs, playbackRate);
      } else {
        synthRef.current.start(buildBackingTracks(song, enabledBacking), currentTimeMs, playbackRate);
      }
      setGamePhase('playing');
    } else {
      // Fresh start: pre-roll countdown
      setGamePhase('countdown');
    }
  };

  // Called by CountdownOverlay when the 4th tick fires.
  const handleCountdownComplete = () => {
    if (!song) return;
    if (embeddedAudio) {
      startAudio(currentTimeMs, playbackRate);
    } else {
      synthRef.current.start(buildBackingTracks(song, enabledBacking), currentTimeMs, playbackRate);
    }
    setGamePhase('playing');
  };

  const handlePause = () => {
    synthRef.current.stop();
    stopAudio();
    offsetRefMs.current = currentTimeMs;
    isWaitingRef.current = false;
    setIsWaiting(false);
    setGamePhase('paused');
  };

  const handleStop = () => {
    synthRef.current.stop();
    stopAudio();
    setGamePhase('idle');
    offsetRefMs.current = 0;
    setCurrentTimeMs(0);
    isWaitingRef.current = false;
    setIsWaiting(false);
    requireSilenceRef.current = false;
    // Reset scoring so next play starts clean
    setScore(INITIAL_SCORE);
    setNoteResults(new Map());
    hitAtRef.current = new Map();
    nextEvalIdxRef.current = 0;
  };

  // From the game screen, "back" returns to the track picker so the user
  // can change which track they play / backing without re-loading the file.
  // The TrackPicker preselects from saved settings, so the previous
  // selection is restored automatically.
  const handleBackToTracks = () => {
    synthRef.current.stop();
    stopAudio();
    setGamePhase('idle');
    offsetRefMs.current = 0;
    setCurrentTimeMs(0);
    setSong(null);
    setScore(INITIAL_SCORE);
    setNoteResults(new Map());
    hitAtRef.current = new Map();
    nextEvalIdxRef.current = 0;
  };

  // Play Again from results: reset score, run countdown again
  const handlePlayAgain = () => {
    if (!song) return;
    offsetRefMs.current = 0;
    setCurrentTimeMs(0);
    setScore(INITIAL_SCORE);
    setNoteResults(new Map());
    hitAtRef.current = new Map();
    nextEvalIdxRef.current = 0;
    setGamePhase('countdown');
  };

  // Keep the mic monitor in sync with state
  useEffect(() => {
    if (micCaptureRef.current) {
      micCaptureRef.current.setMonitorVolume(monitorVolume);
    }
  }, [monitorVolume]);
  useEffect(() => {
    if (micCaptureRef.current) {
      micCaptureRef.current.setMonitorMuted(monitorMuted);
    }
  }, [monitorMuted]);

  // Re-acquire the mic when noise-suppression is toggled mid-session.
  // First-time start happens in handlePlay, so this only fires when the
  // mic is already running.
  useEffect(() => {
    const mic = micCaptureRef.current;
    if (!mic || !mic.isStarted()) return;
    let cancelled = false;
    (async () => {
      try {
        setMicStatus('requesting');
        await mic.restart({ noiseSuppression: noiseSuppress });
        if (!cancelled) setMicStatus('live');
      } catch (err) {
        if (!cancelled) {
          console.warn('[mic] restart failed:', err);
          setMicStatus('denied');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [noiseSuppress]);

  // Dispose mic when the tab unmounts
  useEffect(() => {
    return () => {
      if (micCaptureRef.current) {
        micCaptureRef.current.stop();
        micCaptureRef.current = null;
      }
    };
  }, []);

  // Re-schedule the synth when rate or backing-track selection changes mid-play.
  // The visual rAF loop already picks up the new rate via playbackRateRef.
  useEffect(() => {
    if (isPlaying && song) {
      if (embeddedAudio) {
        // Resync audio element on rate change (no backing-track-selection concept)
        const el = audioElRef.current;
        if (el) el.playbackRate = playbackRate;
      } else {
        synthRef.current.start(
          buildBackingTracks(song, enabledBacking),
          currentTimeMs,
          playbackRate
        );
      }
    }
    // We deliberately don't include currentTimeMs in deps — that would re-schedule
    // every frame. Only rate / backing toggles should trigger this.
  }, [playbackRate, enabledBacking]);

  // Phase 1: pick a file (skipped when a built-in song was loaded directly).
  if (!song && !pickedFile) {
    return (
      <FilePicker
        onFilePicked={setPickedFile}
        onSongDirect={(s) => setSong(s)}
      />
    );
  }
  // Phase 2: pick the player + backing tracks. Only relevant for files —
  // built-in songs already arrive as a Song with one track.
  if (!song && pickedFile) {
    return (
      <TrackPicker
        file={pickedFile}
        onBack={() => { setPickedFile(null); setEmbeddedAudio(undefined); }}
        onSongReady={(s, setup) => { setSong(s); setEmbeddedAudio(setup.embeddedAudio); }}
      />
    );
  }
  if (!song) return null;
  // Phase 3: play (rendered below)

  const playerTuningProfile = song.tracks[song.playerTrackIndex]?.tuning ?? [];
  const profile = playerTuningProfile.length > 0
    ? buildProfileFromTuning(playerTuningProfile, song.instrument)
    : getInstrument(song.instrument);
  const totalTimeMs = displayedNotes.length > 0
    ? Math.max(...displayedNotes.map((n) => n.time + n.duration))
    : 0;

  return (
    <div className="game-screen">
      <HUD
        score={score}
        difficulty={difficulty}
        isPlaying={isPlaying}
        onPause={handlePause}
        onPlay={handlePlay}
        onStop={handleStop}
        songTitle={song.title}
        songArtist={song.artist}
        onDifficultyChange={setDifficulty}
        currentTimeSec={currentTimeMs / 1000}
        totalTimeSec={totalTimeMs / 1000}
        playbackRate={playbackRate}
        onPlaybackRateChange={setPlaybackRate}
        kidsMode={kidsMode}
        onKidsModeChange={setKidsMode}
        waitMode={waitMode}
        onWaitModeChange={setWaitMode}
      />

      <div className="game-stage">
        <SidePanel
          instrument={profile}
          notes={displayedNotes}
          currentTimeMs={currentTimeMs}
          noteResults={noteResults}
          paused={gamePhase === 'paused'}
          totalTimeMs={totalTimeMs}
          onSeek={(t) => {
            offsetRefMs.current = t;
            setCurrentTimeMs(t);
            // Clear stale results past the new position so they don't flash
            // green/red when we resume.
            setNoteResults(new Map());
            hitAtRef.current = new Map();
          }}
        />
        <div className="rain-column">
          <NoteRain
            instrument={profile}
            notes={displayedNotes}
            currentTimeMs={currentTimeMs}
            fallDurationSec={fallDurationSec}
            noteResults={noteResults}
            hitAt={hitAtRef.current}
            hitWindowMs={DIFFICULTIES[difficulty].timingWindowMs}
          />
          <FretboardMini
            instrument={profile}
            notes={displayedNotes}
            currentTimeMs={currentTimeMs}
            noteResults={noteResults}
          />
        </div>
        {isWaiting && <div className="wait-overlay">{t('game:waiting_for_note')}</div>}
      </div>

      <div className="game-footer-bar">
        <button className="back-btn" onClick={handleBackToTracks}>
          {t('game:track_setup_back')}
        </button>

        <div className="backing-controls" title="Backing track volume">
          <button
            className={`mute-btn ${backingMuted ? 'muted' : ''}`}
            onClick={() => setBackingMuted((m) => !m)}
            title={backingMuted ? 'Backing muted (click to unmute)' : 'Mute backing track'}
          >
            {backingMuted ? '🔇' : '🔊'}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={backingVolume}
            onChange={(e) => setBackingVolume(parseFloat(e.target.value))}
            className="vol-slider"
          />
          <span className="vol-label">{t('game:backing')}</span>
        </div>

        <div
          className="backing-controls"
          title={
            monitorVolume > 0 && !monitorMuted
              ? 'Mic monitor on — use headphones to avoid feedback!'
              : 'Mic monitor (hear yourself — needs headphones)'
          }
        >
          <button
            className={`mute-btn ${monitorMuted ? 'muted' : ''}`}
            onClick={() => setMonitorMuted((m) => !m)}
            title={monitorMuted ? 'Mic monitor muted' : 'Mute mic monitor'}
          >
            🎤
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={monitorVolume}
            onChange={(e) => setMonitorVolume(parseFloat(e.target.value))}
            className="vol-slider"
          />
          <span className="vol-label">
            {t('game:mic')}
            {monitorVolume > 0 && !monitorMuted && (
              <span className="headphones-warn" title="Use headphones to avoid feedback">
                {' '}🎧
              </span>
            )}
          </span>
        </div>

        <span className={`mic-status mic-${micStatus}`}>
          {micStatus === 'live' && t('game:mic_live')}
          {micStatus === 'denied' && t('game:mic_denied')}
          {micStatus === 'requesting' && t('game:mic_asking')}
          {micStatus === 'idle' && (micEnabled ? t('game:mic_ready') : t('game:mic_off'))}
        </span>

        {/* Mic debug strip — only shown when mic is live */}
        {micStatus === 'live' && micDebug && (
          <div className="mic-debug-strip" title="Mic debug: RMS level, attack gate, detected pitches">
            <span
              className="mic-debug-gate"
              title={micDebug.gateOpen ? 'Attack gate OPEN — will detect next pluck' : 'Attack gate CLOSED — waiting for silence before next hit'}
              style={{ color: micDebug.gateOpen ? '#2dff8b' : '#ff9d00' }}
            >
              {micDebug.gateOpen ? '▶' : '⏸'}
            </span>
            <span className="mic-debug-rms" title="RMS level (0–100%)">
              <span
                className="mic-debug-rms-bar"
                style={{ width: `${Math.min(100, micDebug.rms * 500)}%` }}
              />
            </span>
            {micDebug.pitches.length === 0
              ? <span className="mic-debug-no-pitch">—</span>
              : micDebug.pitches.map((p, i) => (
                <span
                  key={i}
                  className="mic-debug-pitch"
                  title={`${p.freq.toFixed(1)} Hz  conf ${(p.conf * 100).toFixed(0)}%`}
                  style={{ opacity: 0.5 + p.conf * 0.5 }}
                >
                  {p.note}
                </span>
              ))
            }
          </div>
        )}

        <label className="ns-toggle" title="Suppress fans / HVAC / room hum (may attenuate sustained notes)">
          <input
            type="checkbox"
            checked={noiseSuppress}
            onChange={(e) => setNoiseSuppress(e.target.checked)}
          />
          <span>{t('game:suppress_room_noise')}</span>
        </label>

        <button
          className="calibrate-btn"
          onClick={() => setCalOpen(true)}
          title={calibration ? `Calibrated: ${calibration.instrument} · ${new Date(calibration.calibratedAt).toLocaleDateString()}` : 'Calibrate mic input levels and latency'}
        >
          {calibration ? '🎯' : '🎯'} Cal{calibration ? '✓' : ''}
        </button>

        <button
          className="gear-btn"
          onClick={() => setSettingsOpen(true)}
          title="Advanced settings (latency offset, custom tolerance)"
        >
          ⚙️
        </button>

        <span className="difficulty-info">
          ±{customPitchToleranceCents ?? DIFFICULTIES[difficulty].pitchToleranceCents}¢ /
          ±{DIFFICULTIES[difficulty].timingWindowMs}ms
          {latencyOffsetMs !== 0 && ` · lat ${latencyOffsetMs > 0 ? '+' : ''}${latencyOffsetMs}ms`}
        </span>
      </div>

      {/* Pre-roll countdown */}
      {gamePhase === 'countdown' && synthRef.current.getContext() && (
        <CountdownOverlay
          audioCtx={synthRef.current.getContext()!}
          bpm={Math.max(60, song.tempo / playbackRate)}
          onComplete={handleCountdownComplete}
          onCancel={() => {/* setGamePhase reset elsewhere; cleanup only */}}
        />
      )}

      {/* End-of-song results */}
      {gamePhase === 'results' && (
        <ResultsScreen
          score={score}
          totalNotes={displayedNotes.length}
          notes={displayedNotes}
          noteResults={noteResults}
          instrument={profile}
          songTitle={song.title}
          onPlayAgain={handlePlayAgain}
          onBackToTracks={handleBackToTracks}
        />
      )}

      {/* Calibration wizard */}
      {calOpen && (
        <CalibrationWizard
          onApply={(data) => {
            setCalibration(data);
            setLatencyOffsetMs(data.latencyOffsetMs);
            setCalOpen(false);
          }}
          onClose={() => setCalOpen(false)}
        />
      )}

      {/* Settings drawer */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        difficulty={difficulty}
        latencyOffsetMs={latencyOffsetMs}
        onLatencyOffsetChange={setLatencyOffsetMs}
        customPitchToleranceCents={customPitchToleranceCents}
        onCustomPitchToleranceChange={setCustomPitchToleranceCents}
      />
    </div>
  );
}

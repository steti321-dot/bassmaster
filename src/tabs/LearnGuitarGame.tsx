import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { loadSettings, saveSettings } from '../game/songSettings';
import { simplifyForKids } from '../game/simplify';
import CountdownOverlay from '../game/components/CountdownOverlay';
import ResultsScreen from '../game/components/ResultsScreen';
import SettingsPanel from '../game/components/SettingsPanel';

type GamePhase = 'idle' | 'countdown' | 'playing' | 'paused' | 'results';

/**
 * Tab 2: Learn Guitar Game.
 *
 * Phase 1: Static skeleton — renders a chosen song's notes scrolling down,
 * shows upcoming notes by string/fret, has play/pause controls. No mic/scoring yet.
 */
export default function LearnGuitarGame() {
  const [pickedFile, setPickedFile] = useState<PickedFile | null>(null);
  const [song, setSong] = useState<Song | null>(null);
  const [gamePhase, setGamePhase] = useState<GamePhase>('idle');
  const isPlaying = gamePhase === 'playing';
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [latencyOffsetMs, setLatencyOffsetMs] = useState(0);
  const [customPitchToleranceCents, setCustomPitchToleranceCents] = useState<number | undefined>(undefined);
  const [kidsMode, setKidsMode] = useState(false);
  const [waitMode, setWaitMode] = useState(false);
  const [isWaiting, setIsWaiting] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [backingMuted, setBackingMuted] = useState(false);
  const [backingVolume, setBackingVolume] = useState(0.55);
  const [enabledBacking, setEnabledBacking] = useState<Set<number>>(new Set());
  const [score, setScore] = useState<ScoreState>(INITIAL_SCORE);
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
          }
          elapsed = target.time;
        } else if (isWaitingRef.current) {
          // Just exited the gate (note hit, or wait mode toggled off mid-wait).
          // Re-anchor the real-time clock and resume the synth from here.
          isWaitingRef.current = false;
          setIsWaiting(false);
          startRefMs.current = performance.now() - elapsed / playbackRateRef.current;
          if (song) {
            synthRef.current.start(
              buildBackingTracks(song, enabledBacking),
              elapsed,
              playbackRate,
            );
          }
        }
      } else if (isWaitingRef.current) {
        // Wait mode toggled off while frozen — resume immediately.
        isWaitingRef.current = false;
        setIsWaiting(false);
        startRefMs.current = performance.now() - elapsed / playbackRateRef.current;
        if (song) {
          synthRef.current.start(
            buildBackingTracks(song, enabledBacking),
            elapsed,
            playbackRate,
          );
        }
      }

      setCurrentTimeMs(elapsed);

      // Stop when we're 2 seconds past the last note → show results
      const lastNoteEnd = displayedNotes.length > 0
        ? Math.max(...displayedNotes.map((n) => n.time + n.duration))
        : 0;
      if (elapsed > lastNoteEnd + 2000) {
        synthRef.current.stop();
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
        const RMS_GATE = 0.005;
        // Gate release thresholds. Training Mode is more permissive so a
        // soft re-pluck during the previous note's decay is still detected
        // (the EMA baseline tracks the ringing tail closely, so a 1.5×
        // spike is hard to hit — the user complained that re-plucks
        // weren't registering). Normal scrolling play sticks with the
        // stricter thresholds to keep one pluck from advancing through
        // multiple identical notes.
        const inWait = isWaitingRef.current;
        const ATTACK_RATIO = inWait ? 1.2 : 1.5;
        const ATTACK_FLOOR = inWait ? 0.018 : 0.025;
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
        let detectedFreq = 0;
        const inRefractory = now - lastHitAtRef.current < REFRACTORY_MS;
        if (
          snap &&
          snap.rms > RMS_GATE &&
          !requireSilenceRef.current &&
          !inRefractory
        ) {
          const r = detectPitch(snap.samples, snap.sampleRate, profile.minPitchHz, profile.maxPitchHz);
          if (r.confidence > 0.4) detectedFreq = r.frequency;
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
            continue;
          }

          // Inside the window: did we detect the right pitch? For chords
          // (multiple un-played notes sharing the same time), accept ANY
          // member's pitch — the user can pluck any string of the chord
          // and we score the matching one. Without this, the detector
          // would compare only against the first array member, even when
          // the user played a different chord tone (e.g. the 5th instead
          // of the root). The picked-member's index becomes the actual
          // scored idx; loop continues from there.
          if (detectedFreq > 0) {
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
              // Lock the gate AND start the refractory timer. Anchor the
              // baselines at the hit's RMS so the very next frame compares
              // sustained ringing against this level (not pre-hit silence).
              requireSilenceRef.current = true;
              peakRmsSinceHitRef.current = snap?.rms ?? 0;
              recentRmsRef.current = snap?.rms ?? 0;
              lastHitAtRef.current = now;
              // Stamp the wall-clock time so NoteRain can render a brief
              // hit-burst at this index over the next ~500 ms.
              hitAtRef.current.set(hitIdx, now);
              // Advance nextEvalIdxRef past contiguously-hit chord members
              // so the next frame's loop starts at the first un-played note.
              while (
                nextEvalIdxRef.current < displayedNotes.length &&
                results.has(nextEvalIdxRef.current)
              ) {
                nextEvalIdxRef.current += 1;
              }
            }
          }
        }

        if (resultsChanged) {
          setNoteResults(new Map(results));
        }
        if (scoreChanged) {
          setScore(newScore);
        }
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
      synthRef.current.start(buildBackingTracks(song, enabledBacking), currentTimeMs, playbackRate);
      setGamePhase('playing');
    } else {
      // Fresh start: pre-roll countdown
      setGamePhase('countdown');
    }
  };

  // Called by CountdownOverlay when the 4th tick fires.
  const handleCountdownComplete = () => {
    if (!song) return;
    synthRef.current.start(buildBackingTracks(song, enabledBacking), currentTimeMs, playbackRate);
    setGamePhase('playing');
  };

  const handlePause = () => {
    synthRef.current.stop();
    offsetRefMs.current = currentTimeMs;
    isWaitingRef.current = false;
    setIsWaiting(false);
    setGamePhase('paused');
  };

  const handleStop = () => {
    synthRef.current.stop();
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
      synthRef.current.start(
        buildBackingTracks(song, enabledBacking),
        currentTimeMs,
        playbackRate
      );
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
        onBack={() => setPickedFile(null)}
        onSongReady={(s) => setSong(s)}
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
          />
          <FretboardMini
            instrument={profile}
            notes={displayedNotes}
            currentTimeMs={currentTimeMs}
            noteResults={noteResults}
          />
        </div>
        {isWaiting && <div className="wait-overlay">🎯 Play this note…</div>}
      </div>

      <div className="game-footer-bar">
        <button className="back-btn" onClick={handleBackToTracks}>
          ← Track setup
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
          <span className="vol-label">Backing</span>
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
            Mic
            {monitorVolume > 0 && !monitorMuted && (
              <span className="headphones-warn" title="Use headphones to avoid feedback">
                {' '}🎧
              </span>
            )}
          </span>
        </div>

        <span className={`mic-status mic-${micStatus}`}>
          {micStatus === 'live' && '🟢 mic live'}
          {micStatus === 'denied' && '🔴 mic denied'}
          {micStatus === 'requesting' && '🟡 mic asking…'}
          {micStatus === 'idle' && (micEnabled ? '⚪ mic ready' : '⚫ mic off')}
        </span>

        <label className="ns-toggle" title="Suppress fans / HVAC / room hum (may attenuate sustained notes)">
          <input
            type="checkbox"
            checked={noiseSuppress}
            onChange={(e) => setNoiseSuppress(e.target.checked)}
          />
          <span>Suppress room noise</span>
        </label>

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

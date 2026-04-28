import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Tuner.css';
import { MicCapture } from '../game/MicCapture';
import { detectPitch, centsBetween } from '../game/PitchDetectorJS';
import { BASS, GUITAR, buildProfileFromTuning } from '../game/Instrument';
import type { InstrumentKind, InstrumentProfile } from '../game/Instrument';
import { loadPrefs } from '../game/userPrefs';

type TuningPreset = 'bass' | 'guitar' | 'guitar-drop-d' | 'bass-drop-d';

const PRESETS: Record<TuningPreset, { label: string; kind: InstrumentKind; profile: InstrumentProfile }> = {
  bass: { label: 'Bass', kind: 'bass', profile: BASS },
  'bass-drop-d': {
    label: 'Bass · Drop D',
    kind: 'bass',
    // Bass drop D: G2 D2 A1 D1 (low E dropped to D)
    profile: buildProfileFromTuning([43, 38, 33, 26], 'bass'),
  },
  guitar: { label: 'Guitar', kind: 'guitar', profile: GUITAR },
  'guitar-drop-d': {
    label: 'Guitar · Drop D',
    kind: 'guitar',
    // Guitar drop D: e4 B3 G3 D3 A2 D2 (low E dropped to D)
    profile: buildProfileFromTuning([64, 59, 55, 50, 45, 38], 'guitar'),
  },
};

interface DetectedReading {
  frequency: number;
  confidence: number;
  midi: number;
  noteLabel: string;
  centsFromNote: number;
  /** Closest standard-tuning open string for the active instrument. */
  closestString: { idx: number; cents: number; label: string };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function midiToNoteLabel(midi: number): string {
  const n = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${n}${oct}`;
}

function freqToMidi(freq: number): number {
  return 12 * Math.log2(freq / 440) + 69;
}

function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * Tab 3: Tuner. Listens via mic and shows the currently-played note,
 * mapping it to the closest open string of the chosen instrument.
 */
export default function Tuner() {
  const { t } = useTranslation(['tuner']);
  const [preset, setPreset] = useState<TuningPreset>('bass');
  const [running, setRunning] = useState(false);
  const [micStatus, setMicStatus] = useState<'idle' | 'requesting' | 'live' | 'denied'>('idle');
  const [reading, setReading] = useState<DetectedReading | null>(null);
  const [signalLevel, setSignalLevel] = useState(0);
  const [noiseSuppress, setNoiseSuppress] = useState(() => loadPrefs().noiseSuppressDefault);

  const ctxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const rafRef = useRef<number | null>(null);
  const presetRef = useRef<TuningPreset>(preset);
  presetRef.current = preset;

  useEffect(() => {
    historyRef.current = [];
  }, [preset]);

  // Smoothing: ring buffer of recent fractional-MIDI readings.
  // Median over the buffer => stable note + cents; octave-snap incoming
  // samples to the running median to fight YIN's 2x/0.5x jumps (G1↔G2).
  const historyRef = useRef<number[]>([]);
  const lastUiUpdateRef = useRef<number>(0);
  const lastSignalAtRef = useRef<number>(0);
  // Larger history + slower UI = calmer needle. We tune longer than we
  // play, so latency matters less than steadiness here.
  const HISTORY_SIZE = 24;            // ~400ms of samples
  const UI_UPDATE_INTERVAL_MS = 150;  // 6.7 fps — plenty for a tuner needle
  const READING_HOLD_MS = 600;        // keep last reading on screen during brief silences

  const profile: InstrumentProfile = PRESETS[preset].profile;

  // Start the tuner: request mic, begin rAF loop
  const handleStart = async () => {
    setMicStatus('requesting');
    try {
      if (!ctxRef.current) {
        ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (ctxRef.current.state === 'suspended') {
        await ctxRef.current.resume();
      }
      if (!micRef.current) {
        micRef.current = new MicCapture(ctxRef.current);
      }
      micRef.current.setMonitorMuted(true);
      micRef.current.setMonitorVolume(0);
      await micRef.current.start({ noiseSuppression: noiseSuppress });
      setMicStatus('live');
      setRunning(true);
    } catch (err) {
      console.warn('[tuner] mic start failed:', err);
      setMicStatus('denied');
    }
  };

  const handleStop = () => {
    setRunning(false);
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (micRef.current) {
      micRef.current.stop();
    }
    historyRef.current = [];
    setReading(null);
    setSignalLevel(0);
  };

  // rAF loop: snapshot mic, detect pitch, update reading
  useEffect(() => {
    if (!running) return;

    const tick = () => {
      const mic = micRef.current;
      if (!mic || !mic.isStarted()) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const snap = mic.snapshot();
      if (snap) {
        setSignalLevel(snap.rms);
        if (snap.rms > 0.005) {
          const profileNow = PRESETS[presetRef.current].profile;
          const r = detectPitch(
            snap.samples,
            snap.sampleRate,
            profileNow.minPitchHz,
            profileNow.maxPitchHz
          );
          // Bumped confidence threshold — borderline detections are the
          // single biggest source of needle-jitter on the web build where
          // the room mic picks up more low-amplitude noise.
          if (r.confidence > 0.55 && r.frequency > 0) {
            lastSignalAtRef.current = performance.now();
            let midiF = freqToMidi(r.frequency);

            // Octave-snap against recent median to suppress YIN's 2x/0.5x jumps.
            const hist = historyRef.current;
            if (hist.length >= 3) {
              const sorted = [...hist].sort((a, b) => a - b);
              const median = sorted[sorted.length >> 1];
              while (midiF - median > 6) midiF -= 12;
              while (median - midiF > 6) midiF += 12;
            }

            hist.push(midiF);
            if (hist.length > HISTORY_SIZE) hist.shift();

            // Median of buffer => stable reading
            const sorted = [...hist].sort((a, b) => a - b);
            const smoothMidiF = sorted[sorted.length >> 1];
            const smoothFreq = midiToFreq(smoothMidiF);
            const midi = Math.round(smoothMidiF);
            const cents = (smoothMidiF - midi) * 100;

            // Closest open-string match: octave-fold the input note onto the
            // open-string note class, find which open string is closest in pitch.
            let best = { idx: 0, cents: 9999, label: '' };
            for (let s = 0; s < profileNow.midiTunings.length; s++) {
              const target = profileNow.midiTunings[s];
              const c = centsBetween(smoothFreq, midiToFreq(target));
              if (Math.abs(c) < Math.abs(best.cents)) {
                best = {
                  idx: s,
                  cents: c,
                  label: profileNow.stringLabels[s],
                };
              }
            }

            const now = performance.now();
            if (now - lastUiUpdateRef.current >= UI_UPDATE_INTERVAL_MS) {
              lastUiUpdateRef.current = now;
              setReading({
                frequency: smoothFreq,
                confidence: r.confidence,
                midi,
                noteLabel: midiToNoteLabel(midi),
                centsFromNote: cents,
                closestString: best,
              });
            }
          }
        } else {
          // Don't blank the display the instant the signal dips — wait
          // READING_HOLD_MS of sustained silence first. Without this, the
          // tuner flicks to "—" between every plucked note.
          if (performance.now() - lastSignalAtRef.current > READING_HOLD_MS) {
            historyRef.current = [];
            setReading(null);
          }
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [running]);

  // Restart mic with new constraints when noise-suppress toggles mid-session
  useEffect(() => {
    if (!running) return;
    const mic = micRef.current;
    if (!mic || !mic.isStarted()) return;
    void mic.restart({ noiseSuppression: noiseSuppress }).catch((err) => {
      console.warn('[tuner] mic restart failed:', err);
    });
  }, [noiseSuppress]);

  // Force-release the mic on tab switch, page hide, or window blur. The
  // App-level conditional render already unmounts us on tab switch (which
  // hits the cleanup below), but visibilitychange covers Electron minimize
  // and OS-level focus loss — no chance of two mics open at once.
  useEffect(() => {
    const releaseIfHidden = () => {
      if (document.visibilityState === 'hidden' && micRef.current?.isStarted()) {
        console.log('[tuner] page hidden — releasing mic');
        handleStop();
      }
    };
    document.addEventListener('visibilitychange', releaseIfHidden);
    return () => document.removeEventListener('visibilitychange', releaseIfHidden);
  }, []);

  // Cleanup on unmount — releases the MediaStream tracks (mic light goes off)
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      if (micRef.current) {
        console.log('[tuner] unmount — stopping mic');
        micRef.current.stop();
        micRef.current = null;
      }
      if (ctxRef.current) {
        void ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, []);

  const closestStringOk = reading && Math.abs(reading.closestString.cents) < 5;

  return (
    <div className="tuner-screen">
      <div className="tuner-card">
        <header className="tuner-header">
          <h2>{t('tuner:tuner')}</h2>
          <div className="instrument-toggle">
            {(Object.keys(PRESETS) as TuningPreset[]).map((p) => (
              <button
                key={p}
                className={`inst-btn ${preset === p ? 'active' : ''}`}
                onClick={() => setPreset(p)}
                title={PRESETS[p].profile.midiTunings
                  .slice()
                  .reverse()
                  .map((m) => `${['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'][((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`)
                  .join(' ')}
              >
                {t(`tuner:preset_${p.replace(/-/g, '_')}` as any)}
              </button>
            ))}
          </div>
        </header>

        {/* Big detected-note display */}
        <div className={`tuner-display ${closestStringOk ? 'in-tune' : ''}`}>
          <div className="big-note">
            {reading ? reading.noteLabel : '–'}
          </div>
          <div className="freq-line">
            {reading
              ? `${reading.frequency.toFixed(1)} Hz`
              : running
                ? t('tuner:listening_for_note')
                : t('tuner:press_start')}
          </div>
        </div>

        {/* Cents needle for the closest open string */}
        <div className="needle-section">
          <div className="needle-target">
            {reading ? (
              <>
                {t('tuner:closest_string')}{' '}
                <span
                  className="closest-string"
                  style={{ color: profile.stringColors[reading.closestString.idx] }}
                >
                  {reading.closestString.label}
                </span>{' '}
                · {reading.closestString.cents > 0 ? '+' : ''}
                {reading.closestString.cents.toFixed(0)} ¢
              </>
            ) : (
              '\u00a0' // keeps height stable
            )}
          </div>
          <div className="needle-track">
            <div className="needle-tick flat-100">−100</div>
            <div className="needle-tick flat-50">−50</div>
            <div className="needle-tick centre">0</div>
            <div className="needle-tick sharp-50">+50</div>
            <div className="needle-tick sharp-100">+100</div>
            <div className="needle-zero" />
            {reading && (
              <div
                className="needle"
                style={{
                  left: `${50 + Math.max(-50, Math.min(50, reading.closestString.cents / 2))}%`,
                  background: closestStringOk ? 'var(--cy-green)' : 'var(--cy-orange)',
                  boxShadow: closestStringOk
                    ? '0 0 12px var(--cy-green)'
                    : '0 0 12px var(--cy-orange)',
                }}
              />
            )}
          </div>
          <div className="needle-labels">
            <span>{t('tuner:flat')}</span>
            <span>{t('tuner:sharp')}</span>
          </div>
        </div>

        {/* All strings with status. Display order: lowest pitch on left,
            highest on right — matches the in-game column layout. */}
        <div className="strings-row">
          {profile.stringLabels
            .map((label, idx) => ({ label, idx }))
            .reverse()
            .map(({ label, idx }) => {
            const isActive = reading?.closestString.idx === idx;
            const cents = isActive ? reading!.closestString.cents : null;
            const ok = isActive && cents !== null && Math.abs(cents) < 5;
            return (
              <div
                key={idx}
                className={`string-pill ${isActive ? 'active' : ''} ${ok ? 'ok' : ''}`}
                style={{
                  borderColor: profile.stringColors[idx],
                  color: profile.stringColors[idx],
                }}
              >
                <div className="pill-label">{label}</div>
                <div className="pill-target">
                  {midiToNoteLabel(profile.midiTunings[idx])}
                </div>
                <div className="pill-cents">
                  {isActive
                    ? `${cents! > 0 ? '+' : ''}${cents!.toFixed(0)}¢`
                    : '\u00a0'}
                </div>
              </div>
            );
          })}
        </div>

        {/* Controls + signal meter */}
        <div className="tuner-controls">
          {!running ? (
            <button className="big-start-btn" onClick={handleStart}>
              {t('tuner:start_tuner')}
            </button>
          ) : (
            <button className="big-stop-btn" onClick={handleStop}>
              {t('tuner:stop')}
            </button>
          )}

          <span className={`mic-status mic-${micStatus}`} title={t('tuner:microphone_status')}>
            {micStatus === 'live' && t('tuner:mic_live')}
            {micStatus === 'denied' && t('tuner:mic_denied')}
            {micStatus === 'requesting' && t('tuner:mic_asking')}
            {micStatus === 'idle' && t('tuner:mic_ready')}
          </span>

          <label className="ns-toggle" title="Suppress fans / HVAC / room hum (may attenuate sustained notes)">
            <input
              type="checkbox"
              checked={noiseSuppress}
              onChange={(e) => setNoiseSuppress(e.target.checked)}
            />
            <span>{t('tuner:noise_gate')}</span>
          </label>

          {running && (
            <div className="signal-meter">
              <div
                className="signal-fill"
                style={{ width: `${Math.min(100, signalLevel * 600)}%` }}
              />
            </div>
          )}
        </div>

        <p className="tuner-hint">{t('tuner:hint')}</p>
      </div>
    </div>
  );
}

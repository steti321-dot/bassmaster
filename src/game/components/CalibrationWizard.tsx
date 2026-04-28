import React, { useCallback, useEffect, useRef, useState } from 'react';
import './CalibrationWizard.css';
import { MicCapture } from '../MicCapture';
import { detectPolyphonicPitches } from '../PolyphonicDetectorJS';
import { saveCalibration } from '../calibration';
import type { CalibrationData } from '../calibration';

interface Props {
  onApply: (data: CalibrationData) => void;
  onClose: () => void;
}

type Step = 'intro' | 'silence' | 'low' | 'high' | 'tap' | 'done';

const STEP_ORDER: Step[] = ['tap', 'silence', 'low', 'high', 'done'];

function stepIndex(s: Step) { return STEP_ORDER.indexOf(s); }

function freqLabel(hz: number): string {
  if (hz <= 0) return '—';
  const midi  = Math.round(69 + 12 * Math.log2(hz / 440));
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const note  = names[((midi % 12) + 12) % 12];
  const oct   = Math.floor(midi / 12) - 1;
  return `${note}${oct} (${hz.toFixed(0)} Hz)`;
}

function playClick(ctx: AudioContext, when: number, hi = false) {
  const osc = ctx.createOscillator();
  const g   = ctx.createGain();
  osc.connect(g);
  g.connect(ctx.destination);
  osc.type = 'triangle';
  osc.frequency.value = hi ? 1200 : 880;
  g.gain.setValueAtTime(0.28, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.07);
  osc.start(when);
  osc.stop(when + 0.07);
}

const TAP_BPM      = 80;
const TAP_INTERVAL = 60 / TAP_BPM;   // seconds
const WARMUP       = 2;
const SCORED_TAPS  = 4;

export default function CalibrationWizard({ onApply, onClose }: Props) {
  const [step, setStep]           = useState<Step>('intro');
  const [noiseFloor, setNoiseFloor] = useState(0);
  const [lowHz,  setLowHz]        = useState(0);
  const [highHz, setHighHz]       = useState(0);
  const [lowPeak,  setLowPeak]    = useState(0);
  const [highPeak, setHighPeak]   = useState(0);
  const [latencyMs, setLatencyMs] = useState(0);
  const [liveRms,   setLiveRms]   = useState(0);
  const [liveHz,    setLiveHz]    = useState(0);
  const [progress,  setProgress]  = useState(0);   // 0–1
  const [tapCount,  setTapCount]  = useState(0);
  const [tapBeats,  setTapBeats]  = useState<number[]>([]); // visual beat indicators

  const ctxRef        = useRef<AudioContext | null>(null);
  const micRef        = useRef<MicCapture  | null>(null);
  const tapOffsets    = useRef<number[]>([]);
  const scheduledBeats = useRef<number[]>([]);  // AudioContext times

  // Boot audio+mic once
  useEffect(() => {
    const ctx = new AudioContext();
    const mic = new MicCapture(ctx);
    ctxRef.current = ctx;
    micRef.current = mic;
    mic.start().catch(() => {});
    return () => { mic.stop(); ctx.close(); };
  }, []);

  // ── Silence step (3 s auto) ──────────────────────────────────────────
  useEffect(() => {
    if (step !== 'silence') return;
    const rmsSamples: number[] = [];
    const t0 = Date.now();
    const DURATION = 3000;
    const id = setInterval(() => {
      const snap = micRef.current?.snapshot();
      if (snap) rmsSamples.push(snap.rms);
      const elapsed = Date.now() - t0;
      setProgress(Math.min(1, elapsed / DURATION));
      if (elapsed >= DURATION) {
        clearInterval(id);
        const avg = rmsSamples.length
          ? rmsSamples.reduce((s, v) => s + v, 0) / rmsSamples.length
          : 0.002;
        setNoiseFloor(avg);
        setProgress(0);
        setStep('low');
      }
    }, 50);
    return () => clearInterval(id);
  }, [step]);

  // ── Low / High string steps ──────────────────────────────────────────
  const collHz    = useRef<number[]>([]);
  const collPeak  = useRef(0);
  const collecting = useRef(false);
  const collectT0  = useRef(0);

  useEffect(() => {
    if (step !== 'low' && step !== 'high') return;
    collHz.current    = [];
    collPeak.current  = 0;
    collecting.current = false;
    setLiveRms(0);
    setLiveHz(0);
    setProgress(0);

    const detectedInstrument =
      lowHz > 0 && lowHz < 62 ? 'bass' : lowHz >= 62 && lowHz < 120 ? 'guitar' : 'unknown';
    const minHz = step === 'low' ? 28
      : detectedInstrument === 'bass'   ? 75
      : detectedInstrument === 'guitar' ? 250
      : 75;
    const maxHz = step === 'low' ? 220
      : detectedInstrument === 'bass'   ? 180
      : detectedInstrument === 'guitar' ? 450
      : 1400;
    const COLLECT_MS = 2500;
    const SIGNAL_THRESH = () => Math.max(noiseFloor * 4, 0.004);

    const id = setInterval(() => {
      const snap = micRef.current?.snapshot();
      if (!snap) return;
      setLiveRms(snap.rms);

      const pitches = detectPolyphonicPitches(
        snap.samples, snap.sampleRate, minHz, maxHz, 1,
      );
      const top = pitches[0];

      if (top && snap.rms > SIGNAL_THRESH()) {
        setLiveHz(top.frequency);
        if (!collecting.current) {
          collecting.current = true;
          collectT0.current  = Date.now();
          collHz.current     = [];
          collPeak.current   = 0;
        }
        collHz.current.push(top.frequency);
        collPeak.current = Math.max(collPeak.current, snap.rms);
        const elapsed = Date.now() - collectT0.current;
        setProgress(Math.min(1, elapsed / COLLECT_MS));

        if (elapsed >= COLLECT_MS) {
          clearInterval(id);
          const sorted  = [...collHz.current].sort((a, b) => a - b);
          const medianHz = sorted[Math.floor(sorted.length / 2)];
          const peak     = collPeak.current;
          if (step === 'low') {
            setLowHz(medianHz);
            setLowPeak(peak);
            setStep('high');
          } else {
            setHighHz(medianHz);
            setHighPeak(peak);
            setStep('done');
          }
          setLiveHz(0);
          setLiveRms(0);
          setProgress(0);
        }
      } else {
        // Signal dropped — reset if less than 500ms collected
        if (collecting.current && Date.now() - collectT0.current < 500) {
          collecting.current = false;
          setProgress(0);
        }
      }
    }, 50);
    return () => clearInterval(id);
  }, [step, noiseFloor]);

  // ── Tap step ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (step !== 'tap') return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    tapOffsets.current   = [];
    scheduledBeats.current = [];
    setTapCount(0);
    setTapBeats([]);

    // Resume context if suspended (autoplay policy)
    ctx.resume().then(() => {
      const t0 = ctx.currentTime + 0.5;
      for (let i = 0; i < WARMUP + SCORED_TAPS; i++) {
        const t = t0 + i * TAP_INTERVAL;
        playClick(ctx, t, i === 0);
        if (i >= WARMUP) scheduledBeats.current.push(t);
      }
      // Visual beat flash via real-time check
      const beatMs = (WARMUP + SCORED_TAPS) * TAP_INTERVAL * 1000 + 800;
      const id = setInterval(() => {
        const now = ctx.currentTime;
        const beat = scheduledBeats.current.findIndex(
          b => Math.abs(now - b) < 0.08,
        );
        if (beat >= 0) setTapBeats(prev => [...prev, beat]);
      }, 30);
      const timeout = setTimeout(() => clearInterval(id), beatMs);
      return () => { clearInterval(id); clearTimeout(timeout); };
    });
  }, [step]);

  const handleTap = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || tapOffsets.current.length >= SCORED_TAPS) return;
    const now    = ctx.currentTime;
    const beats  = scheduledBeats.current;
    let   nearest = beats[0] ?? now;
    let   minDiff = Infinity;
    for (const b of beats) {
      const d = Math.abs(now - b);
      if (d < minDiff) { minDiff = d; nearest = b; }
    }
    tapOffsets.current.push((now - nearest) * 1000);
    const count = tapOffsets.current.length;
    setTapCount(count);
    if (count >= SCORED_TAPS) {
      const sorted = [...tapOffsets.current].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      // Subtract ~200 ms assumed motor reaction time
      setLatencyMs(Math.round(median - 200));
      setTimeout(() => setStep('silence'), 400);
    }
  }, []);

  // ── Derived results ──────────────────────────────────────────────────
  const instrument: 'guitar' | 'bass' | 'unknown' =
    lowHz > 0 && lowHz < 62 ? 'bass' : lowHz >= 62 && lowHz < 120 ? 'guitar' : 'unknown';

  const highStringLabel =
    instrument === 'guitar' ? 'high e string (thinnest)' :
    instrument === 'bass'   ? 'G string (thinnest)'      : 'thinnest string';

  const signalPeak      = lowPeak > 0 && highPeak > 0
    ? Math.min(lowPeak, highPeak) : Math.max(lowPeak, highPeak);
  const rmsGate         = Math.max(0.004, noiseFloor * 2.5);
  const attackFloor     = Math.max(rmsGate * 1.5, signalPeak * 0.15, 0.006);

  function handleApply() {
    const data: CalibrationData = {
      noiseFloorRms: noiseFloor,
      rmsGate,
      attackFloor,
      latencyOffsetMs: latencyMs,
      instrument,
      lowStringHz: lowHz,
      highStringHz: highHz,
      calibratedAt: new Date().toISOString(),
    };
    saveCalibration(data);
    onApply(data);
    onClose();
  }

  const curIdx = stepIndex(step);

  return (
    <div className="cal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cal-modal">

        {/* Header */}
        <div className="cal-header">
          <h2 className="cal-title">CALIBRATION</h2>
          <button className="cal-close" onClick={onClose} aria-label="Close">✕</button>
        </div>

        {/* Step dots */}
        {step !== 'intro' && (
          <div className="cal-step-dots">
            {STEP_ORDER.map((s, i) => (
              <div key={s} className={
                `cal-dot ${curIdx === i ? 'cal-dot--active' : ''} ${curIdx > i ? 'cal-dot--done' : ''}`
              } />
            ))}
          </div>
        )}

        {/* ── intro ── */}
        {step === 'intro' && (
          <div className="cal-body">
            <p className="cal-lead">Let us measure your setup in 4 quick steps so the game can detect your notes reliably.</p>
            <ul className="cal-checklist">
              <li>⏱ Optional tap test for latency</li>
              <li>🔇 Measure background noise (3 s)</li>
              <li>🎸 Play your open <strong>low E</strong> string</li>
              <li>🎸 Play your open <strong>high string</strong></li>
            </ul>
            <p className="cal-hint">Have your instrument in your hands. The tap test is first — then put it down briefly for the noise step.</p>
            <button className="cal-btn cal-btn--primary" onClick={() => setStep('tap')}>
              Start calibration
            </button>
          </div>
        )}

        {/* ── silence ── */}
        {step === 'silence' && (
          <div className="cal-body">
            <div className="cal-step-label">STEP 2 — NOISE FLOOR</div>
            <p className="cal-lead">Stay quiet — don't touch your instrument.</p>
            <div className="cal-progress-track">
              <div className="cal-progress-bar" style={{ width: `${progress * 100}%` }} />
            </div>
            <p className="cal-hint">{(progress * 3).toFixed(1)} / 3.0 s</p>
          </div>
        )}

        {/* ── low string ── */}
        {step === 'low' && (
          <div className="cal-body">
            <div className="cal-step-label">STEP 3 — LOW E STRING</div>
            <p className="cal-lead">
              Play your open <strong>low E string</strong> and hold it.
              <br /><span className="cal-hint">Guitar: E2 (82 Hz) · Bass: E1 (41 Hz)</span>
            </p>
            <SignalMeter rms={liveRms} noiseFloor={noiseFloor} />
            {liveHz > 0 && (
              <div className="cal-live-note">🎵 {freqLabel(liveHz)}</div>
            )}
            {progress > 0 && (
              <div className="cal-progress-track">
                <div className="cal-progress-bar cal-progress-bar--green" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            {progress === 0 && liveRms < Math.max(noiseFloor * 4, 0.004) && (
              <p className="cal-hint cal-hint--waiting">Waiting for signal…</p>
            )}
          </div>
        )}

        {/* ── high string ── */}
        {step === 'high' && (
          <div className="cal-body">
            <div className="cal-step-label">STEP 4 — HIGH STRING</div>
            {instrument !== 'unknown' && (
              <div className="cal-detected-badge">Detected: {instrument.toUpperCase()}</div>
            )}
            <p className="cal-lead">
              Play your open <strong>{highStringLabel}</strong> and hold it.
              <br /><span className="cal-hint">
                {instrument === 'guitar' ? 'Guitar: high e (E4 = 329 Hz)' :
                 instrument === 'bass'   ? 'Bass: G string (G2 = 98 Hz)' :
                 'Thinnest string'}
              </span>
            </p>
            <SignalMeter rms={liveRms} noiseFloor={noiseFloor} />
            {liveHz > 0 && (
              <div className="cal-live-note">🎵 {freqLabel(liveHz)}</div>
            )}
            {progress > 0 && (
              <div className="cal-progress-track">
                <div className="cal-progress-bar cal-progress-bar--green" style={{ width: `${progress * 100}%` }} />
              </div>
            )}
            {progress === 0 && liveRms < Math.max(noiseFloor * 4, 0.004) && (
              <p className="cal-hint cal-hint--waiting">Waiting for signal…</p>
            )}
          </div>
        )}

        {/* ── tap ── */}
        {step === 'tap' && (
          <div className="cal-body">
            <div className="cal-step-label">STEP 1 — LATENCY (OPTIONAL)</div>
            <p className="cal-lead">Tap the button in time with the clicks.</p>
            <div className="cal-tap-beats">
              {Array.from({ length: SCORED_TAPS }).map((_, i) => (
                <div key={i} className={`cal-tap-beat ${tapBeats.includes(i) ? 'cal-tap-beat--flash' : ''} ${i < tapCount ? 'cal-tap-beat--hit' : ''}`} />
              ))}
            </div>
            <button
              className="cal-tap-btn"
              onClick={handleTap}
              onKeyDown={(e) => { if (e.code === 'Space') { e.preventDefault(); handleTap(); } }}
              autoFocus
            >
              TAP
              <span className="cal-tap-count">{tapCount} / {SCORED_TAPS}</span>
            </button>
            <button className="cal-btn cal-btn--ghost" onClick={() => { setLatencyMs(0); setStep('silence'); }}>
              Skip this step
            </button>
          </div>
        )}

        {/* ── done ── */}
        {step === 'done' && (
          <div className="cal-body">
            <div className="cal-step-label">✓ CALIBRATION COMPLETE</div>
            <table className="cal-results">
              <tbody>
                <tr>
                  <td>Instrument</td>
                  <td className="cal-val">{instrument === 'unknown' ? '?' : instrument.toUpperCase()}</td>
                </tr>
                <tr>
                  <td>Low string</td>
                  <td className="cal-val">{freqLabel(lowHz)}</td>
                </tr>
                <tr>
                  <td>High string</td>
                  <td className="cal-val">{freqLabel(highHz)}</td>
                </tr>
                <tr>
                  <td>Noise floor</td>
                  <td className="cal-val">{(noiseFloor * 100).toFixed(2)} %</td>
                </tr>
                <tr>
                  <td>Signal peak</td>
                  <td className="cal-val">{(signalPeak * 100).toFixed(2)} %</td>
                </tr>
                <tr>
                  <td>RMS gate</td>
                  <td className="cal-val">{(rmsGate * 100).toFixed(2)} %</td>
                </tr>
                <tr>
                  <td>Attack floor</td>
                  <td className="cal-val">{(attackFloor * 100).toFixed(2)} %</td>
                </tr>
                <tr>
                  <td>Latency offset</td>
                  <td className="cal-val">{latencyMs > 0 ? '+' : ''}{latencyMs} ms {latencyMs === 0 ? '(skipped)' : ''}</td>
                </tr>
              </tbody>
            </table>
            <div className="cal-actions">
              <button className="cal-btn cal-btn--primary" onClick={handleApply}>
                Apply &amp; save
              </button>
              <button className="cal-btn cal-btn--ghost" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Signal meter sub-component ───────────────────────────────────────────
function SignalMeter({ rms, noiseFloor }: { rms: number; noiseFloor: number }) {
  const pct   = Math.min(100, rms * 500);
  const floor = Math.min(100, noiseFloor * 500);
  return (
    <div className="cal-meter" title={`RMS: ${(rms * 100).toFixed(2)}%`}>
      <div className="cal-meter-bar" style={{ width: `${pct}%` }} />
      <div className="cal-meter-floor" style={{ left: `${floor}%` }} title="Noise floor" />
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import './CountdownOverlay.css';

interface CountdownOverlayProps {
  /** Audio context to schedule the metronome ticks on. */
  audioCtx: AudioContext;
  /** BPM — beat interval = 60_000 / bpm ms. */
  bpm: number;
  /** Called once after the last tick — game should transition to 'playing' here. */
  onComplete: () => void;
  /** Called if the user cancelled (Stop). Cleans up any pending audio. */
  onCancel?: () => void;
}

const SEQUENCE = ['3', '2', '1', 'GO!'];

/**
 * Pre-roll countdown overlay. Shows 3 → 2 → 1 → GO! synchronised with
 * metronome ticks at the song's tempo. Uses the same AudioContext as the
 * BackingSynth so we don't allocate a new one.
 */
export default function CountdownOverlay({
  audioCtx,
  bpm,
  onComplete,
  onCancel,
}: CountdownOverlayProps) {
  const [step, setStep] = useState(0);
  const timersRef = useRef<number[]>([]);
  const scheduledOscillatorsRef = useRef<AudioScheduledSourceNode[]>([]);

  useEffect(() => {
    const beatMs = Math.max(150, Math.min(2000, 60000 / bpm));
    const startTime = audioCtx.currentTime + 0.05;

    // Schedule all 4 ticks up front via Web Audio's precise clock so they
    // stay in time even if the React UI lags.
    for (let i = 0; i < SEQUENCE.length; i++) {
      const tickTime = startTime + (i * beatMs) / 1000;
      const isLast = i === SEQUENCE.length - 1;
      scheduleTick(audioCtx, tickTime, isLast);
    }

    // Drive the visual numerals from setTimeout chains.
    for (let i = 0; i < SEQUENCE.length; i++) {
      const id = window.setTimeout(() => setStep(i), i * beatMs);
      timersRef.current.push(id);
    }

    // After the last tick + a small grace, complete.
    const completeId = window.setTimeout(
      () => onComplete(),
      SEQUENCE.length * beatMs - 50 // start the song right on the last tick
    );
    timersRef.current.push(completeId);

    return () => {
      for (const id of timersRef.current) clearTimeout(id);
      timersRef.current = [];
      for (const o of scheduledOscillatorsRef.current) {
        try { o.stop(); } catch {}
        try { o.disconnect(); } catch {}
      }
      scheduledOscillatorsRef.current = [];
      if (onCancel) onCancel();
    };
  }, []); // run once on mount

  function scheduleTick(ctx: AudioContext, startSec: number, accent: boolean) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Final tick is higher / louder so "GO!" is unmistakeable
    osc.frequency.value = accent ? 1320 : 880;
    const peak = accent ? 0.4 : 0.25;
    gain.gain.setValueAtTime(0.0001, startSec);
    gain.gain.linearRampToValueAtTime(peak, startSec + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startSec);
    osc.stop(startSec + 0.1);
    scheduledOscillatorsRef.current.push(osc);
  }

  const current = SEQUENCE[step];
  const isGo = current === 'GO!';

  return (
    <div className="countdown-overlay">
      <div className={`countdown-numeral ${isGo ? 'go' : ''}`} key={step}>
        {current}
      </div>
    </div>
  );
}

import React, { useEffect, useRef, useState } from 'react';
import './TabPreview.css';

interface Note {
  fret: number;
  string: number;
  stringName?: string;
  time: number;
  duration: number;
  frequency: number;
}

interface TabPreviewProps {
  notes: Note[];
  tempo: number;
  instrument?: 'guitar' | 'bass';
}

const GUITAR_LABELS = ['e', 'B', 'G', 'D', 'A', 'E'];
const BASS_LABELS = ['G', 'D', 'A', 'E'];

const PIXELS_PER_SECOND = 80;
const STRING_GAP = 22;
const TOP_PAD = 24;
const LEFT_PAD = 36;

export default function TabPreview({ notes, tempo, instrument = 'guitar' }: TabPreviewProps) {
  const STRING_LABELS = instrument === 'bass' ? BASS_LABELS : GUITAR_LABELS;
  const numStrings = STRING_LABELS.length;
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scheduledNodesRef = useRef<Array<OscillatorNode | GainNode>>([]);
  const animationRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Bounds
  const totalDurationMs =
    notes.length > 0 ? Math.max(...notes.map((n) => n.time + n.duration)) : 0;
  const totalSeconds = Math.max(2, totalDurationMs / 1000);
  const width = LEFT_PAD + totalSeconds * PIXELS_PER_SECOND + 30;
  const height = TOP_PAD + STRING_GAP * numStrings + 16;

  // Generate beat lines from tempo (every quarter note)
  const beatIntervalSec = 60.0 / tempo;
  const beatLines: number[] = [];
  for (let t = 0; t <= totalSeconds; t += beatIntervalSec) {
    beatLines.push(t);
  }

  const stop = React.useCallback(() => {
    scheduledNodesRef.current.forEach((n) => {
      try {
        if ('stop' in n) (n as OscillatorNode).stop();
      } catch {}
      try {
        n.disconnect();
      } catch {}
    });
    scheduledNodesRef.current = [];
    if (animationRef.current !== null) {
      cancelAnimationFrame(animationRef.current);
      animationRef.current = null;
    }
    setPlaying(false);
    setPlayheadMs(0);
  }, []);

  const play = () => {
    if (playing) {
      stop();
      return;
    }
    if (notes.length === 0) return;

    const ctx = audioCtxRef.current ?? new AudioContext();
    audioCtxRef.current = ctx;
    if (ctx.state === 'suspended') ctx.resume();

    const t0 = ctx.currentTime + 0.05;
    startTimeRef.current = performance.now() + 50;

    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = n.frequency;

      const startSec = t0 + n.time / 1000;
      const durSec = Math.max(0.05, n.duration / 1000);

      // Simple ADSR-like envelope
      gain.gain.setValueAtTime(0, startSec);
      gain.gain.linearRampToValueAtTime(0.18, startSec + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.05, startSec + durSec * 0.6);
      gain.gain.linearRampToValueAtTime(0.0, startSec + durSec);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(startSec);
      osc.stop(startSec + durSec + 0.05);

      scheduledNodesRef.current.push(osc, gain);
    }

    setPlaying(true);

    const tick = () => {
      const elapsed = performance.now() - startTimeRef.current;
      setPlayheadMs(elapsed);
      if (elapsed >= totalDurationMs + 200) {
        stop();
      } else {
        animationRef.current = requestAnimationFrame(tick);
      }
    };
    animationRef.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    return () => stop();
  }, [stop]);

  if (notes.length === 0) {
    return (
      <div className="tab-preview empty">
        <p>No notes to preview.</p>
      </div>
    );
  }

  return (
    <div className="tab-preview">
      <div className="tab-controls">
        <button className={`play-btn ${playing ? 'playing' : ''}`} onClick={play}>
          {playing ? '⏸ Stop' : '▶ Play'}
        </button>
        <span className="tab-meta">
          {notes.length} notes · {tempo} BPM · {totalSeconds.toFixed(1)}s
        </span>
      </div>

      <div className="tab-scroll">
        <svg
          width={width}
          height={height}
          xmlns="http://www.w3.org/2000/svg"
          className="tab-svg"
        >
          {/* Background */}
          <rect x={0} y={0} width={width} height={height} fill="#fdfdfa" />

          {/* String lines */}
          {STRING_LABELS.map((label, i) => {
            const y = TOP_PAD + i * STRING_GAP;
            return (
              <g key={`str-${i}`}>
                <line
                  x1={LEFT_PAD}
                  y1={y}
                  x2={width - 10}
                  y2={y}
                  stroke="#999"
                  strokeWidth={i < 3 ? 1 : 1.4}
                />
                <text
                  x={LEFT_PAD - 8}
                  y={y + 4}
                  textAnchor="end"
                  fontSize="13"
                  fontWeight="600"
                  fill="#666"
                >
                  {label}
                </text>
              </g>
            );
          })}

          {/* Beat grid */}
          {beatLines.map((t, i) => {
            const x = LEFT_PAD + t * PIXELS_PER_SECOND;
            const isMeasure = i % 4 === 0;
            return (
              <line
                key={`beat-${i}`}
                x1={x}
                y1={TOP_PAD - 4}
                x2={x}
                y2={TOP_PAD + STRING_GAP * (numStrings - 1) + 4}
                stroke={isMeasure ? '#aaa' : '#e0e0e0'}
                strokeWidth={isMeasure ? 1 : 0.5}
              />
            );
          })}

          {/* Notes */}
          {notes.map((n, i) => {
            const x = LEFT_PAD + (n.time / 1000) * PIXELS_PER_SECOND;
            const w = Math.max(14, (n.duration / 1000) * PIXELS_PER_SECOND);
            const y = TOP_PAD + n.string * STRING_GAP;
            return (
              <g key={`n-${i}`} className="note-group">
                {/* Bar showing duration */}
                <rect
                  x={x}
                  y={y - 6}
                  width={w}
                  height={12}
                  fill="#667eea"
                  fillOpacity={0.18}
                  rx={2}
                />
                {/* Fret number circle */}
                <circle cx={x + 7} cy={y} r={9} fill="#fff" stroke="#667eea" strokeWidth={1.5} />
                <text
                  x={x + 7}
                  y={y + 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontWeight="700"
                  fill="#333"
                >
                  {n.fret}
                </text>
              </g>
            );
          })}

          {/* Playhead */}
          {playing && (
            <line
              x1={LEFT_PAD + (playheadMs / 1000) * PIXELS_PER_SECOND}
              y1={TOP_PAD - 4}
              x2={LEFT_PAD + (playheadMs / 1000) * PIXELS_PER_SECOND}
              y2={TOP_PAD + STRING_GAP * (numStrings - 1) + 4}
              stroke="#e74c3c"
              strokeWidth={2}
            />
          )}

          {/* Time labels (every 1s) */}
          {Array.from({ length: Math.ceil(totalSeconds) + 1 }).map((_, i) => (
            <text
              key={`t-${i}`}
              x={LEFT_PAD + i * PIXELS_PER_SECOND}
              y={height - 4}
              textAnchor="middle"
              fontSize="10"
              fill="#999"
            >
              {i}s
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}

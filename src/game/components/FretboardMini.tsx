/**
 * Fretboard panel — sits below the note rain, full-width, showing the
 * upcoming chord/note as colored dots on a 12-fret diagram. Helpful when
 * a chip's stripe is long enough that reading the fret number inside is
 * awkward, or when a chord has multiple notes in different positions.
 */

import React, { useEffect, useRef, useState } from 'react';
import './FretboardMini.css';
import type { InstrumentProfile } from '../Instrument';
import { pitchClassColor } from '../Instrument';
import type { GameNote } from '../types';

interface FretboardMiniProps {
  instrument: InstrumentProfile;
  notes: GameNote[];
  currentTimeMs: number;
  noteResults?: Map<number, 'hit' | 'miss'>;
}

const FRET_COUNT = 12;

function useElementWidth<T extends HTMLElement>(): [
  React.RefObject<T>,
  number,
] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setWidth(Math.max(280, rect.width));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export default function FretboardMini({
  instrument,
  notes,
  currentTimeMs,
  noteResults,
}: FretboardMiniProps) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();

  // First unplayed note in the future (with small grace).
  const startIdx = notes.findIndex(
    (n, i) => !noteResults?.has(i) && n.time > currentTimeMs - 50,
  );

  // Always render the chrome — even when nothing's coming up — so the
  // panel doesn't pop in/out and shift the layout. We just hide the dots.
  const group: GameNote[] = [];
  let etaMs = 0;
  if (startIdx >= 0) {
    const t = notes[startIdx].time;
    etaMs = t - currentTimeMs;
    for (let i = startIdx; i < notes.length && notes[i].time === t; i++) {
      if (!noteResults?.has(i)) group.push(notes[i]);
    }
  }

  const stringCount = instrument.tuningsHz.length;

  // Layout
  const padLeft = 30;
  const padRight = 14;
  const padTop = 10;
  const stringGap = 16;
  const usableW = Math.max(120, width - padLeft - padRight);
  const fretSpacing = usableW / FRET_COUNT;
  const stringY = (s: number) => padTop + s * stringGap;
  const H = padTop + (stringCount - 1) * stringGap + 18;

  // Dot X: fret 0 sits on the nut line itself (left of fret 1).
  const dotX = (fret: number) =>
    fret === 0 ? padLeft - 6 : padLeft + (fret - 0.5) * fretSpacing;

  const etaLabel =
    startIdx < 0
      ? 'done'
      : etaMs > 0
        ? `in ${(etaMs / 1000).toFixed(1)}s`
        : 'now';

  return (
    <div ref={containerRef} className="fretboard-mini" aria-label="Upcoming chord">
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`}>
        {/* String lines + labels */}
        {Array.from({ length: stringCount }).map((_, s) => (
          <g key={`s-${s}`}>
            <line
              x1={padLeft - 6}
              y1={stringY(s)}
              x2={width - padRight}
              y2={stringY(s)}
              stroke="rgba(0, 245, 255, 0.22)"
              strokeWidth={s < stringCount / 2 ? 1 : 1.4}
            />
            <text
              x={padLeft - 10}
              y={stringY(s) + 3}
              fill={instrument.stringColors[s]}
              fontSize={10}
              fontWeight={700}
              textAnchor="end"
              style={{ filter: `drop-shadow(0 0 3px ${instrument.stringColors[s]})` }}
            >
              {instrument.stringLabels[s]}
            </text>
          </g>
        ))}
        {/* Fret bars (0 = nut, drawn thicker) */}
        {Array.from({ length: FRET_COUNT + 1 }).map((_, f) => (
          <line
            key={`f-${f}`}
            x1={padLeft + f * fretSpacing}
            y1={padTop - 4}
            x2={padLeft + f * fretSpacing}
            y2={padTop + (stringCount - 1) * stringGap + 4}
            stroke={f === 0 ? 'var(--cy-cyan)' : 'rgba(0, 245, 255, 0.14)'}
            strokeWidth={f === 0 ? 2 : 1}
          />
        ))}
        {/* Inlay markers — 3, 5, 7, 9, 12 (12 gets two dots) */}
        {[3, 5, 7, 9, 12].map((f) => {
          const x = padLeft + (f - 0.5) * fretSpacing;
          const y = padTop + (stringCount - 1) * stringGap + 12;
          if (f === 12) {
            return (
              <g key={`inlay-${f}`}>
                <circle cx={x - 4} cy={y} r={1.6} fill="rgba(0, 245, 255, 0.4)" />
                <circle cx={x + 4} cy={y} r={1.6} fill="rgba(0, 245, 255, 0.4)" />
              </g>
            );
          }
          return <circle key={`inlay-${f}`} cx={x} cy={y} r={1.8} fill="rgba(0, 245, 255, 0.35)" />;
        })}
        {/* Dots for the upcoming group */}
        {group.map((n, gi) => {
          if (n.fret > FRET_COUNT) return null;
          const midi = (instrument.midiTunings[n.string] ?? 0) + n.fret;
          const fill = pitchClassColor(midi);
          return (
            <g key={`dot-${gi}`}>
              <circle
                cx={dotX(n.fret)}
                cy={stringY(n.string)}
                r={7}
                fill={fill}
                stroke="#0b1019"
                strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 5px ${fill})` }}
              />
              <text
                x={dotX(n.fret)}
                y={stringY(n.string) + 3}
                fill="#0b1019"
                fontSize={8}
                fontWeight={800}
                textAnchor="middle"
              >
                {n.fret}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="fretboard-mini-eta">
        {group.length > 1 ? `chord · ${etaLabel}` : etaLabel}
      </div>
    </div>
  );
}

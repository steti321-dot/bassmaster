/**
 * Mini fretboard overlay. Floats in the top-right of the game stage and
 * shows the upcoming note (or chord) as dots on a small fretboard so the
 * player can see the shape at a glance — easier than reading numbers
 * inside individual chip stripes when a chord is held for a long time.
 */

import React from 'react';
import './FretboardMini.css';
import type { InstrumentProfile } from '../Instrument';
import { pitchClassColor } from '../Instrument';
import type { GameNote } from '../types';

interface FretboardMiniProps {
  instrument: InstrumentProfile;
  notes: GameNote[];
  currentTimeMs: number;
  /** Notes already scored — used to skip past them when finding the
   *  current/next chord. */
  noteResults?: Map<number, 'hit' | 'miss'>;
}

const FRET_COUNT = 6; // show frets 0–5 — matches Kids Mode's window

export default function FretboardMini({
  instrument,
  notes,
  currentTimeMs,
  noteResults,
}: FretboardMiniProps) {
  // Find the first unplayed note in the future (with a small grace so the
  // card doesn't flicker when the chord lands on the hit line).
  const startIdx = notes.findIndex(
    (n, i) => !noteResults?.has(i) && n.time > currentTimeMs - 50,
  );
  if (startIdx < 0) return null;

  // Collect every note sharing the same time — that's our group/chord.
  const t = notes[startIdx].time;
  const group: GameNote[] = [];
  for (let i = startIdx; i < notes.length && notes[i].time === t; i++) {
    if (!noteResults?.has(i)) group.push(notes[i]);
  }
  if (group.length === 0) return null;

  const stringCount = instrument.tuningsHz.length;

  // Layout — keep small enough to overlay without dominating the rain.
  const padX = 24;
  const padTop = 10;
  const stringGap = 14;
  const W = 180;
  const H = padTop + (stringCount - 1) * stringGap + 14;
  const usableW = W - padX - 12;
  const fretSpacing = usableW / (FRET_COUNT - 1);
  // String index 0 = highest pitch (top of the diagram in standard tab view).
  const stringY = (s: number) => padTop + s * stringGap;

  // Frets: 0 = nut (left edge), 1..5 = the playable window.
  // Dots sit between fret bars, but fret 0 (open) sits on the nut line.
  const dotX = (fret: number) =>
    fret === 0 ? padX - 6 : padX + (fret - 0.5) * fretSpacing;

  // ETA shown below the diagram so the player knows how soon.
  const dt = t - currentTimeMs;
  const etaLabel = dt > 0 ? `in ${(dt / 1000).toFixed(1)}s` : 'now';

  return (
    <div className="fretboard-mini" aria-label="Upcoming chord">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="fretboard-mini-svg">
        {/* String lines + labels */}
        {Array.from({ length: stringCount }).map((_, s) => (
          <g key={`s-${s}`}>
            <line
              x1={padX - 6}
              y1={stringY(s)}
              x2={W - 6}
              y2={stringY(s)}
              stroke="rgba(0, 245, 255, 0.22)"
              strokeWidth={s < stringCount / 2 ? 1 : 1.4}
            />
            <text
              x={padX - 10}
              y={stringY(s) + 3}
              fill={instrument.stringColors[s]}
              fontSize={9}
              fontWeight={700}
              textAnchor="end"
              style={{ filter: `drop-shadow(0 0 3px ${instrument.stringColors[s]})` }}
            >
              {instrument.stringLabels[s]}
            </text>
          </g>
        ))}
        {/* Fret bars */}
        {Array.from({ length: FRET_COUNT }).map((_, f) => (
          <line
            key={`f-${f}`}
            x1={padX + f * fretSpacing}
            y1={padTop - 4}
            x2={padX + f * fretSpacing}
            y2={padTop + (stringCount - 1) * stringGap + 4}
            stroke={f === 0 ? 'var(--cy-cyan)' : 'rgba(0, 245, 255, 0.14)'}
            strokeWidth={f === 0 ? 2 : 1}
          />
        ))}
        {/* Fret numbers */}
        {[1, 3, 5].map((f) => (
          <text
            key={`fn-${f}`}
            x={padX + (f - 0.5) * fretSpacing}
            y={H - 2}
            fill="var(--cy-text-muted)"
            fontSize={8}
            textAnchor="middle"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {f}
          </text>
        ))}
        {/* Dots for group members */}
        {group.map((n, gi) => {
          const midi = (instrument.midiTunings[n.string] ?? 0) + n.fret;
          const fill = pitchClassColor(midi);
          return (
            <g key={`dot-${gi}`}>
              <circle
                cx={dotX(n.fret)}
                cy={stringY(n.string)}
                r={6}
                fill={fill}
                stroke="#0b1019"
                strokeWidth={1.5}
                style={{ filter: `drop-shadow(0 0 4px ${fill})` }}
              />
              <text
                x={dotX(n.fret)}
                y={stringY(n.string) + 2.5}
                fill="#0b1019"
                fontSize={7}
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

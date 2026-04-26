import React, { useEffect, useRef, useState } from 'react';
import './NoteRain.css';
import type { GameNote } from '../types';
import type { InstrumentProfile } from '../Instrument';
import { pitchClassColor } from '../Instrument';

interface NoteRainProps {
  /** Profile that determines column count + colors. */
  instrument: InstrumentProfile;
  /** All notes in the song. */
  notes: GameNote[];
  /** Current playback time, in milliseconds. */
  currentTimeMs: number;
  /** How long it takes a note to fall from top to hit line, in seconds. */
  fallDurationSec: number;
  /** For each note (by index), latest result: 'hit', 'miss', or null if pending. */
  noteResults: Map<number, 'hit' | 'miss'>;
}

/** Hook: measure a DOM element's size, updates on resize. */
function useElementSize<T extends HTMLElement>(): [React.RefObject<T>, { width: number; height: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ width: Math.max(200, rect.width), height: Math.max(200, rect.height) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, size];
}

// All sizes are computed from the measured container so the canvas always fits
// the available window space.
const HIT_LINE_FRACTION = 0.7; // hit line two-thirds down — leaves room above for upcoming notes
const TOP_SCALE = 0.45; // chip size at horizon
const BOTTOM_SCALE = 1.0; // chip size at the hit line
// Chips are flat poker-chip ellipses, not circles. ry/rx ratio = how flat they look.
// Lower = flatter (more "lying down"), so they don't visually overlap each other vertically.
const CHIP_FLATNESS = 0.34;
// How long a chip lingers (and fades) after the head crosses the hit line, in ms.
// Short values = chips disappear quickly so they don't clutter the played-area.
const HIT_LINGER_MS = 90;

export default function NoteRain({
  instrument,
  notes,
  currentTimeMs,
  fallDurationSec,
  noteResults,
}: NoteRainProps) {
  const [containerRef, { width: totalWidth, height: stageHeight }] = useElementSize<HTMLDivElement>();
  const numStrings = instrument.tuningsHz.length;

  // Compute column dimensions to fill available width
  const usableWidth = totalWidth - 60; // outer padding
  const columnGap = Math.max(8, usableWidth * 0.018);
  const columnWidth = (usableWidth - columnGap * (numStrings - 1)) / numStrings;
  const baseLeftX = 30;
  const stageCenterX = totalWidth / 2;

  // Chip sizing: smaller than the column so consecutive chips never visually crowd.
  // Capped at an absolute max so chips stay readable but never gigantic on huge windows.
  const baseBulbRadius = Math.min(columnWidth * 0.36, 56);

  // Perspective horizon sits above the visible area so notes "come from a distance"
  const perspectiveHorizonY = -stageHeight * 0.6;
  const hitLineY = stageHeight * HIT_LINE_FRACTION;
  const fallDistance = hitLineY;
  const pixelsPerMs = fallDistance / (fallDurationSec * 1000);

  /** Compute (x, scale) for a note at vertical position y.
   *
   * Column layout: lowest pitch on the LEFT, highest pitch on the RIGHT —
   * matches Rocksmith / Guitar Hero convention. Internally `stringIdx` is
   * still 0=highest, so we mirror it into the visible column index here. */
  function project(stringIdx: number, y: number): { x: number; scale: number } {
    const colIdx = numStrings - 1 - stringIdx;
    const t = Math.max(0, Math.min(1, (hitLineY - y) / (hitLineY - perspectiveHorizonY)));
    const baseX = baseLeftX + colIdx * (columnWidth + columnGap) + columnWidth / 2;
    const x = baseX + (stageCenterX - baseX) * t;
    const visT = Math.max(0, Math.min(1, (hitLineY - y) / hitLineY));
    const scale = BOTTOM_SCALE - (BOTTOM_SCALE - TOP_SCALE) * visT;
    return { x, scale };
  }

  const visibleNotes = notes
    .map((n, i) => ({ note: n, idx: i }))
    .filter(({ note }) => {
      const dtHead = note.time - currentTimeMs;
      // Visible from when the tail enters the stage to when the head has just
      // crossed the hit line. Played notes disappear quickly (HIT_LINGER_MS).
      const dtTail = note.time + note.duration - currentTimeMs;
      return dtTail < fallDurationSec * 1000 + 200 && dtHead > -HIT_LINGER_MS;
    });

  return (
    <div className="note-rain" ref={containerRef}>
      <svg
        width={totalWidth}
        height={stageHeight}
        viewBox={`0 0 ${totalWidth} ${stageHeight}`}
        preserveAspectRatio="xMidYMid meet"
        className="rain-svg"
      >
        {/* Perspective floor — dark gradient with subtle cyan glow at horizon */}
        <defs>
          <linearGradient id="floor-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(0, 245, 255, 0.04)" />
            <stop offset="100%" stopColor="rgba(0, 245, 255, 0.0)" />
          </linearGradient>
          <radialGradient id="hit-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0, 245, 255, 0.5)" />
            <stop offset="100%" stopColor="rgba(0, 245, 255, 0)" />
          </radialGradient>
        </defs>
        <rect x={0} y={0} width={totalWidth} height={stageHeight} fill="url(#floor-gradient)" />

        {/* Horizontal "depth" grid lines — magenta near horizon, cyan near hit line */}
        {[0.92, 0.78, 0.62, 0.42, 0.22, 0.08].map((t, i) => {
          const y = hitLineY * (1 - t);
          const color = t > 0.6 ? 'rgba(255, 68, 255, 0.18)' : 'rgba(0, 245, 255, 0.22)';
          return (
            <line
              key={`depth-${i}`}
              x1={10}
              y1={y}
              x2={totalWidth - 10}
              y2={y}
              stroke={color}
              strokeWidth={0.8}
              strokeDasharray="3 7"
            />
          );
        })}

        {/* Column "rails" converging to the horizon */}
        {Array.from({ length: numStrings }).map((_, s) => {
          const top = project(s, 0);
          const bottom = project(s, hitLineY);
          const c = instrument.stringColors[s];
          return (
            <g key={`col-${s}`}>
              <line
                x1={top.x}
                y1={0}
                x2={bottom.x}
                y2={hitLineY}
                stroke={c}
                strokeWidth={1.6}
                strokeOpacity={0.45}
                style={{ filter: `drop-shadow(0 0 4px ${c})` }}
              />
              <text
                x={bottom.x}
                y={stageHeight - 16}
                textAnchor="middle"
                fontSize="28"
                fontWeight="800"
                fill={c}
                style={{
                  filter: `drop-shadow(0 0 6px ${c})`,
                  letterSpacing: '0.08em',
                }}
              >
                {instrument.stringLabels[s]}
              </text>
            </g>
          );
        })}

        {/* Hit line — bright cyan with bloom */}
        <ellipse
          cx={totalWidth / 2}
          cy={hitLineY}
          rx={totalWidth * 0.6}
          ry={28}
          fill="url(#hit-glow)"
        />
        <line
          x1={0}
          y1={hitLineY}
          x2={totalWidth}
          y2={hitLineY}
          stroke="#00f5ff"
          strokeWidth={2}
          style={{ filter: 'drop-shadow(0 0 8px #00f5ff)' }}
        />
        <line
          x1={0}
          y1={hitLineY + 2}
          x2={totalWidth}
          y2={hitLineY + 2}
          stroke="#00f5ff"
          strokeOpacity={0.3}
          strokeWidth={6}
        />

        {/* Falling bulbs (sorted back-to-front so closer bulbs render on top) */}
        {[...visibleNotes]
          .sort((a, b) => a.note.time - b.note.time) // farther = earlier in array → drawn first
          .reverse()
          .map(({ note, idx }) => {
            // Head = onset hits the line at note.time
            // Tail = end of duration hits the line at note.time + duration
            const dtHead = note.time - currentTimeMs;
            const dtTail = note.time + note.duration - currentTimeMs;
            const yHead = hitLineY - dtHead * pixelsPerMs;
            const yTail = hitLineY - dtTail * pixelsPerMs;

            const headProj = project(note.string, yHead);
            const tailProj = project(note.string, yTail);
            const scale = headProj.scale;

            // Offset chip + stripe BESIDE the string line, not directly on top of it,
            // so the colored string rail stays visible behind the note.
            // Lower-half strings lean right of their column, upper-half lean left —
            // gives the eye a clear association of chip → string.
            const halfStrings = numStrings / 2;
            const offsetSign = note.string < halfStrings ? +1 : -1;
            const sideOffset = baseBulbRadius * 0.55 * scale * offsetSign;
            const xHead = headProj.x + sideOffset;
            const xTail = tailProj.x + sideOffset * (tailProj.scale / scale);

            // Chip colored by PITCH CLASS so consecutive notes at different
            // frets are visibly different (even on the same string). String
            // identity is still readable from the rail/label colors behind.
            const noteMidi = (instrument.midiTunings[note.string] ?? 0) + note.fret;
            const color = pitchClassColor(noteMidi);
            const result = noteResults.get(idx);

            let stroke = color;
            let fillOpacity = 0.96;
            if (result === 'hit') {
              stroke = '#2ecc71';
              fillOpacity = 0.45;
            } else if (result === 'miss') {
              stroke = '#e74c3c';
              fillOpacity = 0.3;
            }

            // Fade out after the head crosses the hit line
            let opacityFactor = 1;
            if (dtHead < 0) {
              opacityFactor = Math.max(0, 1 + dtHead / HIT_LINGER_MS);
            }
            if (opacityFactor <= 0) return null;

            const rxHead = baseBulbRadius * scale;
            const rxTail = baseBulbRadius * tailProj.scale;
            const ryHead = rxHead * CHIP_FLATNESS;

            // Stripe-only rendering: the chip ellipse is gone, the fret number
            // sits inside the trapezoid. Very short notes (e.g., 1/16 at fast
            // tempo) would shrink the stripe below readable height, so we
            // enforce a minimum height equal to the fret-number's font size.
            const minStripeH = Math.max(22, ryHead * 1.6);
            const naturalH = yHead - yTail;
            // If the natural stripe is too short, push the tail upward so
            // the visual length covers the minimum. Note timing is unchanged.
            const yTailDraw = Math.min(yTail, yHead - minStripeH);
            const tailDrawProj = naturalH < minStripeH
              ? project(note.string, yTailDraw)
              : tailProj;
            const xTailDraw = tailDrawProj.x + sideOffset * (tailDrawProj.scale / scale);
            const rxTailDraw = baseBulbRadius * tailDrawProj.scale;

            // Trapezoidal stripe body (head at bottom, tail at top, follows column perspective)
            const stripePath =
              `M ${xHead - rxHead * 0.62} ${yHead} ` +
              `L ${xHead + rxHead * 0.62} ${yHead} ` +
              `L ${xTailDraw + rxTailDraw * 0.62} ${yTailDraw} ` +
              `L ${xTailDraw - rxTailDraw * 0.62} ${yTailDraw} Z`;

            // Centre the fret number within the stripe.
            // For very long notes the digit will scroll down with the stripe
            // — that's the trade we're making for cleaner short-note layout.
            const textY = (yHead + yTailDraw) / 2;
            const textX = (xHead + xTailDraw) / 2;
            const textSize = Math.max(11, Math.min(ryHead * 1.4, (yHead - yTailDraw) * 0.55));

            // Subtle perspective tilt — only a fraction of the rail's full
            // angle so the digit follows the lane without looking laid flat.
            const railTop = project(note.string, 0);
            const railBottom = project(note.string, hitLineY);
            const fullTiltDeg =
              Math.atan2(railTop.x - railBottom.x, hitLineY) * (180 / Math.PI);
            const tiltDeg = fullTiltDeg * 0.4;

            return (
              <g key={`note-${idx}`} className="bulb" style={{ color }} opacity={opacityFactor}>
                {/* Stripe body */}
                <path
                  d={stripePath}
                  fill={color}
                  fillOpacity={0.32 * fillOpacity}
                  stroke="none"
                />
                <path
                  d={stripePath}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={0.95}
                  strokeWidth={Math.max(1.6, 2.4 * scale)}
                  strokeLinejoin="round"
                />
                {/* Fret number — bright white with a dark outline + colored
                    glow. Reads on every pitch colour and matches the cyber
                    aesthetic. Tilted slightly toward the column's perspective. */}
                <text
                  x={textX}
                  y={textY}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={textSize}
                  fontWeight="800"
                  fill="#ffffff"
                  stroke="#0b1019"
                  strokeWidth={Math.max(0.8, 1.2 * scale)}
                  paintOrder="stroke"
                  style={{
                    filter: `drop-shadow(0 0 ${Math.max(2, 3 * scale)}px ${stroke})`,
                    letterSpacing: '0.04em',
                  }}
                  transform={`rotate(${tiltDeg.toFixed(2)} ${textX.toFixed(2)} ${textY.toFixed(2)})`}
                >
                  {note.fret}
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}

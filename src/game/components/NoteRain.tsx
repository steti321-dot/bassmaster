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
  /** Wall-clock timestamp of when each note was hit. Used to render a
   *  brief expanding-ring burst on each fresh hit. */
  hitAt?: Map<number, number>;
  /** Onset timing window in ms (the difficulty's pitch-acceptance window).
   *  Used to highlight chips whose head is currently inside the
   *  scoreable region — the user gets a visual "play me NOW" cue. */
  hitWindowMs?: number;
}

interface CoinParticle {
  x: number; y: number;
  vx: number; vy: number;
  age: number;
  lifetime: number;
  size: number;
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

const HIT_LINE_FRACTION = 0.88;
const TOP_SCALE = 0.45;
const BOTTOM_SCALE = 1.0;
const CHIP_FLATNESS = 0.34;
const HIT_LINGER_MS = 90;
const HIT_BURST_MS = 480;
const COIN_GRAVITY = 700;   // px/s²
const COIN_INTERVAL = 75;   // ms between coin spawns per sustained note

/** Bezier "flame tongue" path: wide at base, narrows to a tip. */
function flamePath(cx: number, base: number, r: number, h: number, lean: number): string {
  return (
    `M ${cx - r} ${base}` +
    ` Q ${cx + lean} ${base - h * 0.55} ${cx} ${base - h}` +
    ` Q ${cx + lean * 0.4} ${base - h * 0.55} ${cx + r} ${base} Z`
  );
}

export default function NoteRain({
  instrument,
  notes,
  currentTimeMs,
  fallDurationSec,
  noteResults,
  hitAt,
  hitWindowMs = 250,
}: NoteRainProps) {
  const [containerRef, { width: totalWidth, height: stageHeight }] = useElementSize<HTMLDivElement>();
  const numStrings = instrument.tuningsHz.length;

  // Coin particle state — mutated in-place each render (game-loop pattern)
  const coinsRef    = useRef<CoinParticle[]>([]);
  const lastEmitRef = useRef<Map<number, number>>(new Map());
  const prevNowRef  = useRef(performance.now());

  const usableWidth = totalWidth - 60;
  const columnGap = Math.max(8, usableWidth * 0.018);
  const columnWidth = (usableWidth - columnGap * (numStrings - 1)) / numStrings;
  const baseLeftX = 30;
  const stageCenterX = totalWidth / 2;

  const baseBulbRadius = Math.min(columnWidth * 0.36, 56);

  const railTopY = 0;
  const perspectiveHorizonY = -stageHeight * 0.6;
  const hitLineY = stageHeight * HIT_LINE_FRACTION;
  const fallDistance = hitLineY;
  const pixelsPerMs = fallDistance / (fallDurationSec * 1000);

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
      const dtTail = note.time + note.duration - currentTimeMs;
      return dtTail > -HIT_LINGER_MS && dtHead < fallDurationSec * 1000 + 200;
    });

  // ── Coin physics + emission (game-loop side-effect in render body) ────────
  const nowWall = performance.now();
  const dt = Math.min(50, nowWall - prevNowRef.current);
  prevNowRef.current = nowWall;

  // Advance existing coins
  for (const c of coinsRef.current) {
    c.age += dt;
    c.x   += c.vx * dt / 1000;
    c.y   += c.vy * dt / 1000;
    c.vy  += COIN_GRAVITY * dt / 1000;
  }
  coinsRef.current = coinsRef.current.filter(c => c.age < c.lifetime);

  // Emit from each currently-sustained hit note
  for (const { note, idx } of visibleNotes) {
    if (noteResults.get(idx) !== 'hit') continue;
    if (note.time + note.duration <= currentTimeMs) continue;
    const last = lastEmitRef.current.get(idx) ?? 0;
    if (nowWall - last >= COIN_INTERVAL) {
      lastEmitRef.current.set(idx, nowWall);
      coinsRef.current.push({
        x:        totalWidth - 16 - Math.random() * 28,
        y:        hitLineY   -  4 - Math.random() * 16,
        vx:       (Math.random() - 0.5) * 80,
        vy:       -(220 + Math.random() * 180),
        age:      0,
        lifetime: 900 + Math.random() * 350,
        size:     7 + Math.random() * 3,
      });
    }
  }

  return (
    <div className="note-rain" ref={containerRef}>
      <svg
        width={totalWidth}
        height={stageHeight}
        viewBox={`0 0 ${totalWidth} ${stageHeight}`}
        style={{ fontFamily: 'inherit' }}
      >
        <defs>
          <radialGradient id="floor-gradient" cx="50%" cy="100%" r="60%">
            <stop offset="0%" stopColor="rgba(0,245,255,0.18)" />
            <stop offset="100%" stopColor="rgba(0,245,255,0)" />
          </radialGradient>
          <radialGradient id="hit-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="rgba(0,245,255,0.55)" />
            <stop offset="100%" stopColor="rgba(0,245,255,0)" />
          </radialGradient>
        </defs>

        {/* Floor gradient */}
        <rect x={0} y={hitLineY} width={totalWidth} height={stageHeight - hitLineY}
              fill="url(#floor-gradient)" />

        {/* Depth grid lines — subtle horizontal dashes converging toward horizon */}
        {[0.18, 0.32, 0.46, 0.60, 0.74, 0.87].map((frac, gi) => {
          const y = hitLineY * frac;
          const left  = project(numStrings - 1, y);
          const right = project(0, y);
          const xL = Math.min(left.x,  right.x) - baseBulbRadius * left.scale;
          const xR = Math.max(right.x, left.x)  + baseBulbRadius * right.scale;
          return (
            <line key={`grid-${gi}`}
              x1={xL} y1={y} x2={xR} y2={y}
              stroke={gi < 3 ? 'rgba(255,68,255,0.07)' : 'rgba(0,245,255,0.07)'}
              strokeWidth={0.8} strokeDasharray="4 6" />
          );
        })}

        {/* Column rails (perspective lines from hit line toward horizon) */}
        {Array.from({ length: numStrings }).map((_, s) => {
          const bottom = project(s, hitLineY);
          const top    = project(s, railTopY);
          const colIdx = numStrings - 1 - s;
          const label  = instrument.stringLabels[s];
          const lcolor = instrument.stringColors[s];
          return (
            <g key={`rail-${s}`}>
              <line
                x1={bottom.x} y1={hitLineY}
                x2={top.x}    y2={railTopY}
                stroke={lcolor}
                strokeOpacity={0.22}
                strokeWidth={1.2}
              />
              {/* String label at the bottom (below hit line) */}
              <text
                x={bottom.x}
                y={hitLineY + 16}
                textAnchor="middle"
                fontSize={11}
                fontWeight={700}
                fill={lcolor}
                style={{ filter: `drop-shadow(0 0 4px ${lcolor})` }}
              >
                {label}
              </text>
            </g>
          );
        })}

        {/* Hit line */}
        {(() => {
          const leftProj  = project(numStrings - 1, hitLineY);
          const rightProj = project(0, hitLineY);
          const xL = leftProj.x  - baseBulbRadius * 1.1;
          const xR = rightProj.x + baseBulbRadius * 1.1;
          return (
            <g>
              {/* Wide glow behind the line */}
              <rect
                x={xL} y={hitLineY - 14}
                width={xR - xL} height={28}
                fill="url(#hit-glow)"
                rx={4}
              />
              {/* The line itself */}
              <line
                x1={xL} y1={hitLineY}
                x2={xR} y2={hitLineY}
                stroke="var(--cy-cyan)"
                strokeWidth={2.2}
                style={{ filter: 'drop-shadow(0 0 6px rgba(0,245,255,0.9))' }}
              />
            </g>
          );
        })()}

        {/* Falling bulbs (sorted back-to-front) */}
        {[...visibleNotes]
          .sort((a, b) => a.note.time - b.note.time)
          .reverse()
          .map(({ note, idx }) => {
            const dtHead = note.time - currentTimeMs;
            const dtTail = note.time + note.duration - currentTimeMs;
            const yHead = hitLineY - Math.max(0, dtHead) * pixelsPerMs;
            const yTail = hitLineY - Math.max(0, dtTail) * pixelsPerMs;

            const headProj = project(note.string, yHead);
            const tailProj = project(note.string, yTail);
            const scale = headProj.scale;

            const halfStrings = numStrings / 2;
            const offsetSign = note.string < halfStrings ? +1 : -1;
            const sideOffset = baseBulbRadius * 0.55 * scale * offsetSign;
            const xHead = headProj.x + sideOffset;
            const xTail = tailProj.x + sideOffset * (tailProj.scale / scale);

            const noteMidi = (instrument.midiTunings[note.string] ?? 0) + note.fret;
            const color = pitchClassColor(noteMidi);
            const result = noteResults.get(idx);

            let stroke = color;
            let fillOpacity = 0.96;
            const isHittable =
              !result &&
              ((dtHead < hitWindowMs && dtHead > -hitWindowMs) ||
                (dtHead < -hitWindowMs && dtTail > 0));
            if (result === 'hit') {
              stroke = '#3dff7a';
              fillOpacity = 0.7;
            } else if (result === 'miss') {
              stroke = '#e74c3c';
              fillOpacity = 0.3;
            }

            let opacityFactor = 1;
            if (dtTail < 0) {
              opacityFactor = Math.max(0, 1 + dtTail / HIT_LINGER_MS);
            }
            if (opacityFactor <= 0) return null;

            const rxHead = baseBulbRadius * scale;
            const rxTail = baseBulbRadius * tailProj.scale;
            const ryHead = rxHead * CHIP_FLATNESS;

            const minStripeH = Math.max(22, ryHead * 1.6);
            const naturalH = yHead - yTail;
            const yTailDraw = Math.min(yTail, yHead - minStripeH);
            const tailDrawProj = naturalH < minStripeH
              ? project(note.string, yTailDraw)
              : tailProj;
            const xTailDraw = tailDrawProj.x + sideOffset * (tailDrawProj.scale / scale);
            const rxTailDraw = baseBulbRadius * tailDrawProj.scale;

            // Half-width at each end — used as the arc x-radius for rounded caps.
            // ry uses the chip's own flatness so the end cap stays perspective-flat.
            const headR    = rxHead * 0.62;
            const tailR    = rxTailDraw * 0.62;
            const capRyH   = ryHead;                          // flat — matches chip
            const capRyT   = capRyH * (tailR / headR);       // scale with perspective
            const stripePath =
              `M ${xHead - headR} ${yHead} ` +
              `A ${headR} ${capRyH} 0 0 1 ${xHead + headR} ${yHead} ` +
              `L ${xTailDraw + tailR} ${yTailDraw} ` +
              `A ${tailR} ${capRyT} 0 0 1 ${xTailDraw - tailR} ${yTailDraw} Z`;

            const textY = (yHead + yTailDraw) / 2;
            const textX = (xHead + xTailDraw) / 2;
            const textSize = Math.max(11, Math.min(ryHead * 1.4, (yHead - yTailDraw) * 0.55));

            const railTop    = project(note.string, 0);
            const railBottom = project(note.string, hitLineY);
            const fullTiltDeg =
              Math.atan2(railTop.x - railBottom.x, hitLineY) * (180 / Math.PI);
            const tiltDeg = fullTiltDeg * 0.4;

            const stripeFillOpacity =
              (isHittable ? 0.55 : 0.32) * fillOpacity;
            const stripeStrokeWidth = Math.max(
              1.6,
              (isHittable ? 3.4 : 2.4) * scale,
            );
            const stripeGlow = isHittable
              ? `drop-shadow(0 0 ${10 * scale}px ${stroke})`
              : 'none';

            // Flame parameters (only computed when note is actively sustaining)
            const isHit      = result === 'hit';
            const isSustaining = isHit && dtTail > 0;
            const flameH = baseBulbRadius * 1.4 * scale;
            const flameR = baseBulbRadius * 0.45 * scale;
            const flameT = nowWall / 1000;
            const lean = [
              Math.sin(flameT * 4.1 + idx)         * flameR * 0.50,
              Math.sin(flameT * 5.7 + idx + 1.3)   * flameR * 0.35,
              Math.sin(flameT * 7.2 + idx + 2.6)   * flameR * 0.20,
            ];

            return (
              <g key={`note-${idx}`} className="bulb" style={{ color }} opacity={opacityFactor}>
                {/* Stripe body */}
                <path
                  d={stripePath}
                  fill={color}
                  fillOpacity={stripeFillOpacity}
                  stroke="none"
                  style={{ filter: stripeGlow }}
                />
                <path
                  d={stripePath}
                  fill="none"
                  stroke={stroke}
                  strokeOpacity={isHittable ? 1 : 0.95}
                  strokeWidth={stripeStrokeWidth}
                  strokeLinejoin="round"
                />
                {/* Fret number */}
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
                {/* Flame — three layered bezier tongues that flicker while sustaining */}
                {isSustaining && (
                  <g pointerEvents="none">
                    <path
                      d={flamePath(xHead, hitLineY, flameR * 1.10, flameH,        lean[0])}
                      fill="#ff3300" opacity={0.70}
                    />
                    <path
                      d={flamePath(xHead, hitLineY, flameR * 0.85, flameH * 0.72, lean[1])}
                      fill="#ff8800" opacity={0.75}
                    />
                    <path
                      d={flamePath(xHead, hitLineY, flameR * 0.55, flameH * 0.45, lean[2])}
                      fill="#ffe000" opacity={0.85}
                    />
                  </g>
                )}
              </g>
            );
          })}

        {/* Hit bursts — expanding green rings on freshly-scored notes */}
        {hitAt && [...hitAt.entries()].map(([idx, ts]) => {
          const note = notes[idx];
          if (!note) return null;
          const age = performance.now() - ts;
          if (age < 0 || age > HIT_BURST_MS) return null;
          const bottom = project(note.string, hitLineY);
          const halfStrings = numStrings / 2;
          const offsetSign = note.string < halfStrings ? +1 : -1;
          const sideOffset = baseBulbRadius * 0.55 * offsetSign;
          const cx = bottom.x + sideOffset;
          const cy = hitLineY;
          const p = age / HIT_BURST_MS;
          const r = baseBulbRadius * (0.5 + 2.5 * p);
          const opacity = (1 - p) * 0.9;
          return (
            <g key={`burst-${idx}`} pointerEvents="none">
              <circle
                cx={cx} cy={cy} r={r}
                fill="none" stroke="#3dff7a"
                strokeWidth={3 * (1 - p) + 1}
                opacity={opacity}
                style={{ filter: 'drop-shadow(0 0 8px #3dff7a)' }}
              />
              <circle
                cx={cx} cy={cy}
                r={baseBulbRadius * (0.7 - 0.7 * p)}
                fill="#3dff7a"
                opacity={opacity * 0.6}
                style={{ filter: 'drop-shadow(0 0 12px #3dff7a)' }}
              />
            </g>
          );
        })}

        {/* Coin fountain — gold coins arc upward from the right edge while a
            note is sustained. Physics are stepped each render frame via refs. */}
        {coinsRef.current.map((c, ci) => {
          const fadeIn  = Math.min(1, c.age / 80);
          const fadeOut = c.age > c.lifetime - 250
            ? (c.lifetime - c.age) / 250 : 1;
          const opacity = fadeIn * fadeOut;
          if (opacity <= 0) return null;
          return (
            <g key={`coin-${ci}`} pointerEvents="none">
              <circle
                cx={c.x} cy={c.y} r={c.size}
                fill="#ffd700" opacity={opacity}
                style={{ filter: 'drop-shadow(0 0 4px #ffaa00)' }}
              />
              {/* Shine highlight */}
              <circle
                cx={c.x - c.size * 0.3} cy={c.y - c.size * 0.3}
                r={c.size * 0.3}
                fill="rgba(255,255,220,0.75)" opacity={opacity}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}

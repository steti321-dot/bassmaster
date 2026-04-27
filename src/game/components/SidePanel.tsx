import React from 'react';
import './SidePanel.css';
import type { GameNote } from '../types';
import type { InstrumentProfile } from '../Instrument';
import { pitchClassColor } from '../Instrument';
import { fingerLabel, fingerName } from '../fingering';

interface SidePanelProps {
  instrument: InstrumentProfile;
  notes: GameNote[];
  currentTimeMs: number;
  /** How many history + upcoming notes to show on each side of the current. */
  count?: number;
  /** When true, a scrub slider is shown so the user can seek through the song. */
  paused?: boolean;
  /** Total song length, used to set the scrub slider range. */
  totalTimeMs?: number;
  /** Called when the user drags the scrub slider. */
  onSeek?: (newTimeMs: number) => void;
  /** Map of note-index → 'hit' | 'miss'. Used so the centre card always
   *  shows the next UNPLAYED note rather than lingering on a just-hit one. */
  noteResults?: Map<number, 'hit' | 'miss'>;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToPitchName(midi: number): string {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Side panel: a vertical column of round "note chips" — past notes drift
 * up off the top, the current/next note is the big chip in the middle,
 * upcoming notes line up below. Each chip shows the string letter (top)
 * and fret number (bottom), color-coded by pitch class. Optimised for
 * narrow horizontal real estate so the rain gets the rest.
 */
export default function SidePanel({
  instrument,
  notes,
  currentTimeMs,
  count = 3,
  paused = false,
  totalTimeMs = 0,
  onSeek,
  noteResults,
}: SidePanelProps) {
  // First un-played note in the future (with small grace).
  const currentIdx = notes.findIndex(
    (n, idx) => !noteResults?.has(idx) && n.time > currentTimeMs - 50,
  );

  // History: most-recent N notes already past (newest near the centre).
  const past: { note: GameNote; idx: number }[] = [];
  if (currentIdx > 0) {
    const start = Math.max(0, currentIdx - count);
    for (let i = currentIdx - 1; i >= start; i--) past.push({ note: notes[i], idx: i });
  } else if (currentIdx === -1 && notes.length > 0) {
    const start = Math.max(0, notes.length - count);
    for (let i = notes.length - 1; i >= start; i--) past.push({ note: notes[i], idx: i });
  }

  // Future: next N notes after the current.
  const future: { note: GameNote; idx: number }[] = [];
  if (currentIdx >= 0) {
    const end = Math.min(notes.length, currentIdx + 1 + count);
    for (let i = currentIdx + 1; i < end; i++) future.push({ note: notes[i], idx: i });
  }

  const current = currentIdx >= 0 ? { note: notes[currentIdx], idx: currentIdx } : null;

  return (
    <div className="side-panel">
      {/* Past — small dimmed chips, oldest at top. */}
      <ul className="chip-list chip-past">
        {past
          .slice()
          .reverse()
          .map(({ note, idx }, i) => (
            <NoteChip
              key={`past-${idx}`}
              note={note}
              instrument={instrument}
              tone="past"
              distance={past.length - 1 - i}
            />
          ))}
      </ul>

      {/* Centre — big current/next chip + pitch + finger info below. */}
      <div className="chip-center">
        {current ? (
          (() => {
            const finger = fingerLabel(current.note.fret, current.note.finger);
            const dt = current.note.time - currentTimeMs;
            const midi =
              (instrument.midiTunings[current.note.string] || 0) + current.note.fret;
            const pitch = midiToPitchName(midi);
            const color = pitchClassColor(midi);
            const stringLetter = instrument.stringLabels[current.note.string] || '?';
            const stringColor = instrument.stringColors[current.note.string];
            return (
              <>
                <div className="chip-current" style={{ '--chip-color': color } as React.CSSProperties}>
                  <span className="chip-current-string" style={{ color: stringColor }}>
                    {stringLetter}
                  </span>
                  <span className="chip-current-fret">{current.note.fret}</span>
                </div>
                <div className="chip-current-pitch" style={{ color }}>
                  {pitch}
                </div>
                <div className="chip-current-finger" title={fingerName(finger.label)}>
                  finger&nbsp;
                  <span className="finger-val">
                    {finger.label}
                    {!finger.fromSource &&
                      finger.label !== 'open' &&
                      finger.label !== '—' && <span className="suggested">~</span>}
                  </span>
                </div>
                <div className="chip-current-eta">
                  {dt > 0 ? `in ${(dt / 1000).toFixed(1)}s` : 'now'}
                </div>
              </>
            );
          })()
        ) : (
          <div className="chip-current empty">—</div>
        )}
      </div>

      {/* Future — medium chips with ETA below each. */}
      <ul className="chip-list chip-future">
        {future.map(({ note, idx }, i) => (
          <NoteChip
            key={`future-${idx}`}
            note={note}
            instrument={instrument}
            tone="future"
            distance={i}
            etaMs={note.time - currentTimeMs}
          />
        ))}
      </ul>

      {/* Scrubber */}
      {paused && totalTimeMs > 0 && onSeek && (
        <div className="wheel-scrub">
          <input
            type="range"
            min={0}
            max={totalTimeMs}
            step={50}
            value={Math.min(currentTimeMs, totalTimeMs)}
            onChange={(e) => onSeek(parseFloat(e.target.value))}
            className="wheel-scrub-input"
            title="Drag to seek"
          />
          <div className="wheel-scrub-times">
            <span>{formatTime(currentTimeMs)}</span>
            <span>{formatTime(totalTimeMs)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

interface NoteChipProps {
  note: GameNote;
  instrument: InstrumentProfile;
  tone: 'past' | 'future';
  distance: number;
  etaMs?: number;
}

function NoteChip({ note, instrument, tone, distance, etaMs }: NoteChipProps) {
  const stringName = instrument.stringLabels[note.string] || '?';
  const stringColor = instrument.stringColors[note.string];
  const midi = (instrument.midiTunings[note.string] || 0) + note.fret;
  const color = pitchClassColor(midi);
  const opacity = Math.max(0.3, 1 - distance * (tone === 'past' ? 0.3 : 0.18));
  const etaLabel =
    etaMs === undefined
      ? ''
      : tone === 'future' && etaMs > 0
        ? `${(etaMs / 1000).toFixed(1)}s`
        : '';

  return (
    <li
      className={`chip-row chip-${tone}-row`}
      style={{ opacity, '--chip-color': color } as React.CSSProperties}
    >
      <span className="chip-mini">
        <span className="chip-mini-string" style={{ color: stringColor }}>
          {stringName}
        </span>
        <span className="chip-mini-fret">{note.fret}</span>
      </span>
      {etaLabel && <span className="chip-eta">{etaLabel}</span>}
    </li>
  );
}

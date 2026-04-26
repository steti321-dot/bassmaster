import React from 'react';
import './SidePanel.css';
import type { GameNote } from '../types';
import type { InstrumentProfile } from '../Instrument';
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

function midiToPitchName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const note = names[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * Side panel: a "wheel" of notes — recently-played notes flow upward off the
 * top, the current/next note sits in the centre as a big card, and upcoming
 * notes line up below. As time advances, the column scrolls upward through
 * the panel.
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
  // Find the "current" note — first un-played note with a small grace window
  // so the card switches as soon as a note is hit/missed instead of lingering
  // on it for 200ms (which caused the SidePanel pitch label to disagree with
  // the chip at the hit line).
  const currentIdx = notes.findIndex(
    (n, idx) =>
      !noteResults?.has(idx) && n.time > currentTimeMs - 50,
  );

  // History: most-recent N notes already past (onset < currentTimeMs - 200)
  const past: { note: GameNote; idx: number }[] = [];
  if (currentIdx > 0) {
    const start = Math.max(0, currentIdx - count);
    for (let i = currentIdx - 1; i >= start; i--) {
      past.push({ note: notes[i], idx: i });
    }
  } else if (currentIdx === -1 && notes.length > 0) {
    const start = Math.max(0, notes.length - count);
    for (let i = notes.length - 1; i >= start; i--) {
      past.push({ note: notes[i], idx: i });
    }
  }

  // Future: next N notes after the current
  const future: { note: GameNote; idx: number }[] = [];
  if (currentIdx >= 0) {
    const end = Math.min(notes.length, currentIdx + 1 + count);
    for (let i = currentIdx + 1; i < end; i++) {
      future.push({ note: notes[i], idx: i });
    }
  }

  const current =
    currentIdx >= 0 ? { note: notes[currentIdx], idx: currentIdx } : null;

  return (
    <div className="side-panel">
      {/* Past — fades upward */}
      <ul className="wheel-list wheel-past">
        {past
          .slice()
          .reverse() /* oldest at top, newest near current card */
          .map(({ note, idx }, i) => {
            const distance = past.length - 1 - i; // 0 = newest past, larger = older
            return (
              <NoteRow
                key={`past-${idx}`}
                note={note}
                instrument={instrument}
                tone="past"
                distance={distance}
                etaMs={note.time - currentTimeMs}
              />
            );
          })}
      </ul>

      {/* Centre — big "current" card */}
      <div className="wheel-center">
        {current ? (
          (() => {
            const finger = fingerLabel(current.note.fret, current.note.finger);
            const dt = current.note.time - currentTimeMs;
            return (
              <div className="next-card">
                <div
                  className="next-pitch"
                  style={{ color: instrument.stringColors[current.note.string] }}
                >
                  {midiToPitchName(
                    (instrument.midiTunings[current.note.string] || 0) + current.note.fret,
                  )}
                </div>
                <div className="next-row">
                  <div className="next-cell">
                    <div className="next-cell-label">String</div>
                    <div
                      className="next-cell-value"
                      style={{ color: instrument.stringColors[current.note.string] }}
                    >
                      {instrument.stringLabels[current.note.string]}
                    </div>
                  </div>
                  <div className="next-cell-divider" />
                  <div className="next-cell">
                    <div className="next-cell-label">Fret</div>
                    <div className="next-cell-value fret-pill">{current.note.fret}</div>
                  </div>
                  <div className="next-cell-divider" />
                  <div className="next-cell" title={fingerName(finger.label)}>
                    <div className="next-cell-label">
                      Finger
                      {!finger.fromSource &&
                        finger.label !== 'open' &&
                        finger.label !== '—' && (
                          <span className="suggested" title="Suggested by app (file has no fingering)">
                            ~
                          </span>
                        )}
                    </div>
                    <div
                      className={`next-cell-value finger-pill ${finger.label === 'open' ? 'open' : ''}`}
                    >
                      {finger.label}
                    </div>
                  </div>
                </div>
                <div className="next-eta">
                  {dt > 0
                    ? `in ${(dt / 1000).toFixed(1)}s`
                    : 'now'}
                </div>
              </div>
            );
          })()
        ) : (
          <div className="next-card empty">— done —</div>
        )}
      </div>

      {/* Future — fades downward */}
      <ul className="wheel-list wheel-future">
        {future.map(({ note, idx }, i) => (
          <NoteRow
            key={`future-${idx}`}
            note={note}
            instrument={instrument}
            tone="future"
            distance={i}
            etaMs={note.time - currentTimeMs}
          />
        ))}
      </ul>

      {/* Scrubber — only when paused, lets the user jump to any moment in
          the song. Active percentage = currentTimeMs / totalTimeMs. */}
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

interface NoteRowProps {
  note: GameNote;
  instrument: InstrumentProfile;
  tone: 'past' | 'future';
  /** 0 = closest to current, larger = further away. Used to fade rows. */
  distance: number;
  etaMs?: number;
}

function NoteRow({ note, instrument, tone, distance, etaMs }: NoteRowProps) {
  const stringName = instrument.stringLabels[note.string] || '?';
  const color = instrument.stringColors[note.string] || '#667eea';
  const pitch = midiToPitchName(
    (instrument.midiTunings[note.string] || 0) + note.fret,
  );
  const opacity = Math.max(0.25, 1 - distance * (tone === 'past' ? 0.3 : 0.22));
  const etaLabel =
    etaMs === undefined
      ? ''
      : tone === 'future' && etaMs > 0
        ? `in ${(etaMs / 1000).toFixed(1)}s`
        : tone === 'past' && etaMs < 0
          ? `${(-etaMs / 1000).toFixed(1)}s ago`
          : '';
  return (
    <li className={`wheel-row wheel-${tone}-row`} style={{ opacity }}>
      <span className="dot" style={{ background: color, color }} />
      <span className="pitch" style={{ color }}>{pitch}</span>
      <span className="label" style={{ color }}>{stringName}</span>
      <span className="fret">{note.fret}</span>
      <span className="eta">{etaLabel}</span>
    </li>
  );
}

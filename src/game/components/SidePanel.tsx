import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import './SidePanel.css';
import type { GameNote } from '../types';
import type { InstrumentProfile } from '../Instrument';
import { pitchClassColor } from '../Instrument';
import { fingerLabel, fingerName } from '../fingering';
import { midiToPitchName } from '../pitchNames';

interface SidePanelProps {
  instrument: InstrumentProfile;
  notes: GameNote[];
  currentTimeMs: number;
  /** How many upcoming preview entries to show. Default 4. */
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

// ─── Run detection ───────────────────────────────────────────────────────────

interface RunInfo {
  startIdx: number;       // index of first note in the run
  length: number;         // total notes in the run
  midi: number;           // MIDI pitch they all share
  passSizes: number[];    // greedy-decomposed pass sizes (e.g. [8,8] for 16, [8,3] for 11)
}

/** Greedy: pull off passes of 8 until the remainder fits in a single shorter pass. */
function pickGrouping(runLength: number): number[] {
  if (runLength < 8) return [runLength];
  const sizes: number[] = [];
  let remaining = runLength;
  while (remaining >= 8) {
    sizes.push(8);
    remaining -= 8;
  }
  if (remaining > 0) sizes.push(remaining);
  return sizes;
}

/** Walk notes left-to-right and detect runs of ≥3 consecutive singletons sharing
 *  the same MIDI pitch. Chord groups (multiple notes sharing the same `time`)
 *  always break a run. */
function computeRuns(notes: GameNote[], instrument: InstrumentProfile): {
  runs: RunInfo[];
  runByNoteIdx: Map<number, RunInfo>;
  groupSizeAtIdx: Map<number, number>;
} {
  const runs: RunInfo[] = [];
  const runByNoteIdx = new Map<number, RunInfo>();
  const groupSizeAtIdx = new Map<number, number>();

  // First pass: tag each note with the size of its chord-group (notes sharing time).
  let i = 0;
  while (i < notes.length) {
    const t = notes[i].time;
    let j = i;
    while (j < notes.length && notes[j].time === t) j++;
    const size = j - i;
    for (let k = i; k < j; k++) groupSizeAtIdx.set(k, size);
    i = j;
  }

  // Second pass: find runs of consecutive singletons with the same MIDI.
  i = 0;
  while (i < notes.length) {
    if ((groupSizeAtIdx.get(i) ?? 1) > 1) { i++; continue; }
    const baseMidi = (instrument.midiTunings[notes[i].string] ?? 0) + notes[i].fret;
    let j = i + 1;
    while (j < notes.length) {
      if ((groupSizeAtIdx.get(j) ?? 1) > 1) break;
      const m = (instrument.midiTunings[notes[j].string] ?? 0) + notes[j].fret;
      if (m !== baseMidi) break;
      j++;
    }
    const length = j - i;
    if (length >= 3) {
      const run: RunInfo = {
        startIdx: i,
        length,
        midi: baseMidi,
        passSizes: pickGrouping(length),
      };
      runs.push(run);
      for (let k = i; k < j; k++) runByNoteIdx.set(k, run);
    }
    i = j;
  }

  return { runs, runByNoteIdx, groupSizeAtIdx };
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
// Kept for backward-compat callers; new code goes through midiToPitchName from pitchNames.ts.
// (Currently unused after the refactor but harmless.)
void NOTE_NAMES;

/**
 * Side panel: a compact column showing the next note (big chip) plus a
 * progress-bar summary when the player is in the middle of a long repeated
 * run, plus a run-collapsed preview of the upcoming notes. The historical
 * "already-played" chips column was removed — leftover wheel concept that
 * added clutter without helping the player.
 */
export default function SidePanel({
  instrument,
  notes,
  currentTimeMs,
  count = 4,
  paused = false,
  totalTimeMs = 0,
  onSeek,
  noteResults,
}: SidePanelProps) {
  const { t, i18n } = useTranslation(['game']);
  const lang = i18n.language;

  // First un-played note in the future (with small grace).
  const currentIdx = notes.findIndex(
    (n, idx) => !noteResults?.has(idx) && n.time > currentTimeMs - 50,
  );

  // Run detection — memoised over the (notes, instrument) pair.
  const { runByNoteIdx, groupSizeAtIdx } = useMemo(
    () => computeRuns(notes, instrument),
    [notes, instrument],
  );

  const currentRun = currentIdx >= 0 ? runByNoteIdx.get(currentIdx) : undefined;
  const current = currentIdx >= 0 ? { note: notes[currentIdx], idx: currentIdx } : null;

  // Where the upcoming-preview should start: just past the current run if
  // we're in one, otherwise just past the current note.
  const previewStart = currentRun
    ? currentRun.startIdx + currentRun.length
    : currentIdx >= 0
      ? currentIdx + 1
      : 0;

  return (
    <div className="side-panel">
      {/* Centre — big current/next chip + pitch + finger info below. */}
      <div className="chip-center">
        {current ? (
          (() => {
            const finger = fingerLabel(current.note.fret, current.note.finger);
            const dt = current.note.time - currentTimeMs;
            const midi =
              (instrument.midiTunings[current.note.string] || 0) + current.note.fret;
            const pitch = midiToPitchName(midi, lang);
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

      {/* Run-summary slot — always rendered at the same height so the panel
          layout is stable. The body shows when the current note is in a run;
          otherwise it stays invisible but reserves the same vertical space. */}
      <div className={`run-summary-slot${currentRun && current ? '' : ' run-summary-slot--empty'}`}>
        {currentRun && current && (
          <RunSummary
            run={currentRun}
            currentIdx={current.idx}
            instrument={instrument}
            noteResults={noteResults}
            lang={lang}
            tRepeatCount={(n: number) => t('game:repeat_count', { count: n })}
            tMeterUniform={(passes: number, cellsPerPass: number) =>
              t('game:repeat_meter_uniform', { passes, cellsPerPass })
            }
            tMeterMixed={(sizes: string) => t('game:repeat_meter_mixed', { sizes })}
            tPass={(n: number, total: number, pos: number, cellsPerPass: number) =>
              t('game:repeat_pass', { n, total, pos, cellsPerPass })
            }
          />
        )}
      </div>

      {/* Upcoming preview — collapsed run-aware list. */}
      <UpcomingPreview
        notes={notes}
        startIdx={previewStart}
        runByNoteIdx={runByNoteIdx}
        groupSizeAtIdx={groupSizeAtIdx}
        instrument={instrument}
        lang={lang}
        maxEntries={count}
      />

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
            title={t('game:draggable_seek')}
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

// ─── Run summary (single-row progress bar, resets per pass) ─────────────────

interface RunSummaryProps {
  run: RunInfo;
  currentIdx: number;
  instrument: InstrumentProfile;
  noteResults?: Map<number, 'hit' | 'miss'>;
  lang: string;
  tRepeatCount: (n: number) => string;
  tMeterUniform: (passes: number, cellsPerPass: number) => string;
  tMeterMixed: (sizes: string) => string;
  tPass: (n: number, total: number, pos: number, cellsPerPass: number) => string;
}

function RunSummary({
  run, currentIdx, instrument, noteResults,
  lang, tRepeatCount, tMeterUniform, tMeterMixed, tPass,
}: RunSummaryProps) {
  const positionInRun = currentIdx - run.startIdx; // 0-based index within run

  // Find which pass we're in by walking pass sizes.
  let cumStart = 0;
  let passIdx = 0;
  for (let p = 0; p < run.passSizes.length; p++) {
    if (positionInRun < cumStart + run.passSizes[p]) { passIdx = p; break; }
    cumStart += run.passSizes[p];
    passIdx = p + 1; // past the end of this pass
  }
  // Clamp passIdx to last pass for the edge case "currentIdx is last note + just done"
  if (passIdx >= run.passSizes.length) passIdx = run.passSizes.length - 1;

  const cellsThisPass = run.passSizes[passIdx];
  const cellPosInPass = positionInRun - cumStart; // 0-based, within current pass
  const passStartNoteIdx = run.startIdx + cumStart;

  const pitch = midiToPitchName(run.midi, lang);
  const color = pitchClassColor(run.midi);

  // Meter label: "N × M" if all sizes equal AND there are ≥2 passes; else "8 + 3".
  const allEqual = run.passSizes.every(s => s === run.passSizes[0]);
  const meter = run.passSizes.length === 1
    ? null
    : (allEqual
        ? tMeterUniform(run.passSizes.length, run.passSizes[0])
        : tMeterMixed(run.passSizes.join(' + ')));

  // Render the cells of the CURRENT pass.
  const cells: React.ReactElement[] = [];
  for (let c = 0; c < cellsThisPass; c++) {
    const noteIdx = passStartNoteIdx + c;
    const result = noteResults?.get(noteIdx);
    let stateClass = 'run-cell--upcoming';
    if (c < cellPosInPass) {
      stateClass = result === 'hit' ? 'run-cell--hit'
                 : result === 'miss' ? 'run-cell--miss'
                 : 'run-cell--upcoming';
    } else if (c === cellPosInPass) {
      stateClass = 'run-cell--current';
    }
    cells.push(<span key={c} className={`run-cell ${stateClass}`} />);
  }

  return (
    <div className="run-summary" style={{ '--chip-color': color } as React.CSSProperties}>
      <div className="run-header">
        <span className="run-count">{tRepeatCount(run.length)}</span>
        <span className="run-pitch" style={{ color }}>{pitch}</span>
      </div>
      {meter && <div className="run-meter">{meter}</div>}
      <div className="run-progress">{cells}</div>
      <div className="run-counter">
        {tPass(passIdx + 1, run.passSizes.length, cellPosInPass + 1, cellsThisPass)}
      </div>
    </div>
  );
}

// ─── Upcoming preview (run-collapsed compact list) ──────────────────────────

interface UpcomingPreviewProps {
  notes: GameNote[];
  startIdx: number;
  runByNoteIdx: Map<number, RunInfo>;
  groupSizeAtIdx: Map<number, number>;
  instrument: InstrumentProfile;
  lang: string;
  maxEntries: number;
}

interface PreviewEntry {
  kind: 'run' | 'single' | 'chord';
  notes: GameNote[];
  count?: number;          // for runs
  terminator?: GameNote;   // for runs that end with a singleton-not-in-a-run
}

function UpcomingPreview({
  notes, startIdx, runByNoteIdx, groupSizeAtIdx, instrument, lang, maxEntries,
}: UpcomingPreviewProps) {
  const entries: PreviewEntry[] = [];
  let i = startIdx;
  while (i < notes.length && entries.length < maxEntries) {
    const groupSize = groupSizeAtIdx.get(i) ?? 1;
    if (groupSize > 1) {
      // Chord — emit as a single chord entry, advance past whole group.
      entries.push({ kind: 'chord', notes: notes.slice(i, i + groupSize) });
      i += groupSize;
      continue;
    }
    const run = runByNoteIdx.get(i);
    if (run && run.startIdx === i) {
      // Run starts here. Try to consume the immediate-next singleton-not-in-a-run
      // as the terminator (rendered inline after `/`).
      const nextIdx = i + run.length;
      let terminator: GameNote | undefined;
      if (
        nextIdx < notes.length &&
        (groupSizeAtIdx.get(nextIdx) ?? 1) === 1 &&
        !runByNoteIdx.has(nextIdx)
      ) {
        terminator = notes[nextIdx];
      }
      entries.push({
        kind: 'run',
        notes: [notes[i]],
        count: run.length,
        terminator,
      });
      i = nextIdx + (terminator ? 1 : 0);
    } else {
      entries.push({ kind: 'single', notes: [notes[i]] });
      i += 1;
    }
  }

  // Always render exactly `maxEntries` rows so the panel height stays stable
  // (empty rows take up the same vertical slot but render invisibly).
  return (
    <ul className="upcoming-preview">
      {Array.from({ length: maxEntries }).map((_, k) => {
        const entry = entries[k];
        return entry ? (
          <PreviewEntryRow key={k} entry={entry} instrument={instrument} lang={lang} />
        ) : (
          <li key={k} className="preview-entry preview-entry--empty" aria-hidden="true">
            &nbsp;
          </li>
        );
      })}
    </ul>
  );
}

interface PreviewEntryRowProps {
  entry: PreviewEntry;
  instrument: InstrumentProfile;
  lang: string;
}

function PreviewEntryRow({ entry, instrument, lang }: PreviewEntryRowProps) {
  const fmt = (n: GameNote) => {
    const stringName = instrument.stringLabels[n.string] || '?';
    const midi = (instrument.midiTunings[n.string] || 0) + n.fret;
    return {
      pos: `${stringName}/${n.fret}`,
      pitch: midiToPitchName(midi, lang),
      color: pitchClassColor(midi),
    };
  };

  if (entry.kind === 'chord') {
    return (
      <li className="preview-entry preview-entry--chord">
        <span className="preview-pos">[{entry.notes.map(n => fmt(n).pos).join(' ')}]</span>
      </li>
    );
  }

  const head = fmt(entry.notes[0]);
  const term = entry.terminator ? fmt(entry.terminator) : null;
  return (
    <li className="preview-entry">
      {entry.kind === 'run' && (
        <span className="preview-count">{entry.count}×</span>
      )}
      <span className="preview-pos" style={{ color: head.color }}>{head.pos}</span>
      <span className="preview-pitch" style={{ color: head.color }}>{head.pitch}</span>
      {term && (
        <span className="preview-terminator">
          <span className="preview-sep">/</span>
          <span className="preview-pos" style={{ color: term.color }}>{term.pos}</span>
          <span className="preview-pitch" style={{ color: term.color }}>{term.pitch}</span>
        </span>
      )}
    </li>
  );
}

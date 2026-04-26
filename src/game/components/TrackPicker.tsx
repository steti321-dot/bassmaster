import React, { useEffect, useState } from 'react';
import './SongPicker.css';
import { inspectGpFile, parseGpFile } from '../Gp4Reader';
import type { GpFileSummary } from '../Gp4Reader';
import type { Song } from '../types';
import { loadSettings } from '../songSettings';
import type { PickedFile } from './FilePicker';

interface TrackPickerProps {
  file: PickedFile;
  onBack: () => void;
  onSongReady: (song: Song, setup: { playerIdx: number; backingSet: Set<number> }) => void;
}

/**
 * Phase 2: Pick the player track + backing tracks for the given file.
 * Restores last selection from per-song settings if available.
 */
export default function TrackPicker({ file, onBack, onSongReady }: TrackPickerProps) {
  const [summary, setSummary] = useState<GpFileSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [playerIdx, setPlayerIdx] = useState<number | null>(null);
  const [backingSet, setBackingSet] = useState<Set<number>>(new Set());

  // Inspect the file (header + tracks only) and apply any saved settings
  useEffect(() => {
    setError(null);
    try {
      const sum = inspectGpFile(file.bytes);
      setSummary(sum);

      const saved = loadSettings(file.name);
      if (saved && saved.playerTrackIdx >= 0 && saved.playerTrackIdx < sum.tracks.length) {
        setPlayerIdx(saved.playerTrackIdx);
        setBackingSet(new Set(saved.backingSet));
      } else {
        // Default: prefer bass as player, only the player in backing
        const bassIdx = sum.tracks.findIndex((t) => t.instrument === 'bass');
        const guitarIdx = sum.tracks.findIndex((t) => t.instrument === 'guitar');
        const def = bassIdx >= 0 ? bassIdx : guitarIdx >= 0 ? guitarIdx : 0;
        setPlayerIdx(def);
        setBackingSet(new Set([def]));
      }
    } catch (err) {
      setError(
        `Could not read "${file.name}": ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  }, [file]);

  const handleStart = () => {
    if (!summary || playerIdx === null) return;
    setError(null);
    try {
      const song = parseGpFile(file.bytes, undefined, playerIdx);
      song.source = file.name;
      song.backingEnabled = new Set(backingSet);
      onSongReady(song, { playerIdx, backingSet: new Set(backingSet) });
    } catch (err) {
      setError(
        `Could not load "${file.name}": ${err instanceof Error ? err.message : 'unknown'}`
      );
    }
  };

  if (!summary) {
    return (
      <div className="song-picker">
        <h2>Loading…</h2>
        {error && <div className="picker-error">{error}</div>}
        <div className="picker-actions">
          <button className="back-btn" onClick={onBack}>
            ← Back to song selection
          </button>
        </div>
      </div>
    );
  }

  const tracks = summary.tracks;
  return (
    <div className="song-picker">
      <h2>Set up your session</h2>
      <div className="picker-section">
        <h3>{summary.title || file.name}</h3>
        <p className="picker-subtitle">
          {summary.artist ? `${summary.artist} · ` : ''}
          {summary.tempo} BPM · {summary.numMeasures} measures · {tracks.length} track
          {tracks.length === 1 ? '' : 's'}
        </p>
      </div>

      <div className="picker-section">
        <div className="setup-table-header">
          <span className="col-play">Play</span>
          <span className="col-back">Backing</span>
          <span className="col-name">Track</span>
          <span className="col-badge">Type</span>
        </div>
        <ul className="setup-list">
          {tracks.map((t) => {
            const isPlayer = t.index === playerIdx;
            const isBacking = backingSet.has(t.index);
            return (
              <li key={t.index} className={`setup-row ${isPlayer ? 'is-player' : ''}`}>
                <span className="col-play">
                  <input
                    type="radio"
                    name="player-track"
                    checked={isPlayer}
                    onChange={() => setPlayerIdx(t.index)}
                  />
                </span>
                <span className="col-back">
                  <input
                    type="checkbox"
                    checked={isBacking}
                    onChange={(e) => {
                      setBackingSet((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(t.index);
                        else next.delete(t.index);
                        return next;
                      });
                    }}
                  />
                </span>
                <span className="col-name">
                  {t.instrument === 'bass' ? '🎸 ' : '🎸 '}
                  {t.name}
                  <span className="track-tuning" title="Tuning (low → high)">
                    {' · '}
                    {t.midiTunings.length > 0
                      ? formatTuning(t.midiTunings)
                      : t.stringCount === 0
                        ? 'drums'
                        : `${t.stringCount} strings`}
                  </span>
                </span>
                <span className="col-badge">
                  <span className={`track-badge ${t.instrument}`}>
                    {t.instrument === 'bass' ? 'BASS' : 'GUITAR'}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="picker-actions">
        <button className="back-btn" onClick={onBack}>
          ← Back to song selection
        </button>
        <button
          className="start-btn"
          onClick={handleStart}
          disabled={playerIdx === null}
        >
          ▶ Start
        </button>
      </div>

      {error && <div className="picker-error">{error}</div>}
    </div>
  );
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
function midiToName(m: number): string {
  return `${NOTE_NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}
function formatTuning(midiTunings: number[]): string {
  // GP file order is high → low (string 0 = highest pitch). Display low → high
  // so the leftmost note matches the lowest column in the game's note rain.
  return [...midiTunings].reverse().map(midiToName).join(' ');
}

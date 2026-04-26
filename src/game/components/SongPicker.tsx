import React, { useEffect, useRef, useState } from 'react';
import './SongPicker.css';
import { DEMO_SONGS } from '../demoSongs';
import { parseGpFile, inspectGpFile } from '../Gp4Reader';
import type { GpFileSummary } from '../Gp4Reader';
import type { Song } from '../types';

interface SongPickerProps {
  onSongSelected: (song: Song) => void;
}

interface LoadedFile {
  bytes: Uint8Array;
  filename: string;
  summary: GpFileSummary;
}

export default function SongPicker({ onSongSelected }: SongPickerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [playerIdx, setPlayerIdx] = useState<number | null>(null);
  const [backingSet, setBackingSet] = useState<Set<number>>(new Set());

  // Default-select sensible tracks when a file finishes loading.
  // Default backing = ONLY the player's own track, so the synth plays the part
  // you've chosen and nothing else. User can opt in to other tracks one by one.
  useEffect(() => {
    if (!loaded) return;
    const tracks = loaded.summary.tracks;
    // Prefer a bass track as default player; else first guitar; else 0
    const bassIdx = tracks.findIndex((t) => t.instrument === 'bass');
    const guitarIdx = tracks.findIndex((t) => t.instrument === 'guitar');
    const defaultPlayer = bassIdx >= 0 ? bassIdx : guitarIdx >= 0 ? guitarIdx : 0;
    setPlayerIdx(defaultPlayer);
    setBackingSet(new Set([defaultPlayer]));
  }, [loaded]);

  const handleDemo = (build: () => Song) => {
    setError(null);
    onSongSelected(build());
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = e.target.files?.[0];
    if (!file) return;

    const ext = file.name.toLowerCase().match(/\.(gp[3-5])$/)?.[0];
    if (!ext) {
      setError(`${file.name} is not a recognized Guitar Pro file (.gp3, .gp4, .gp5).`);
      return;
    }

    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const summary = inspectGpFile(bytes);
      setLoaded({ bytes, filename: file.name, summary });
    } catch (err) {
      setError(
        `Could not read "${file.name}": ${err instanceof Error ? err.message : 'unknown error'}`
      );
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleStart = () => {
    if (!loaded || playerIdx === null) return;
    setError(null);
    try {
      const song = parseGpFile(loaded.bytes, undefined, playerIdx);
      song.source = loaded.filename;
      // Override the parser's defaults with the user's explicit selection
      song.backingEnabled = new Set(backingSet);
      onSongSelected(song);
    } catch (err) {
      setError(
        `Could not load "${loaded.filename}": ${err instanceof Error ? err.message : 'unknown error'}`
      );
    }
  };

  // Step 2: Setup screen — player track + backing tracks + Start
  if (loaded) {
    const tracks = loaded.summary.tracks;
    return (
      <div className="song-picker">
        <h2>Set up your session</h2>
        <div className="picker-section">
          <h3>{loaded.summary.title || loaded.filename}</h3>
          <p className="picker-subtitle">
            {loaded.summary.artist ? `${loaded.summary.artist} · ` : ''}
            {loaded.summary.tempo} BPM · {loaded.summary.numMeasures} measures ·{' '}
            {tracks.length} track{tracks.length === 1 ? '' : 's'}
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
          <button className="back-btn" onClick={() => setLoaded(null)}>
            ← Pick another file
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

  // Step 1: File / demo picker
  return (
    <div className="song-picker">
      <h2>Pick a song to practice</h2>

      <div className="picker-section">
        <h3>Built-in demos</h3>
        <ul className="demo-list">
          {DEMO_SONGS.map((d) => (
            <li key={d.id}>
              <button className="demo-btn" onClick={() => handleDemo(d.build)}>
                {d.label}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="picker-section">
        <h3>Import your own</h3>
        <input
          ref={fileInputRef}
          type="file"
          accept=".gp3,.gp4,.gp5"
          onChange={handleFile}
          style={{ display: 'none' }}
        />
        <button className="import-btn" onClick={() => fileInputRef.current?.click()}>
          📁 Open Guitar Pro file (.gp3 / .gp4 / .gp5)
        </button>
        <p className="picker-hint">
          You can also export a GP4 from the Audio to Notes tab and load it here.
        </p>
      </div>

      {error && <div className="picker-error">{error}</div>}
    </div>
  );
}

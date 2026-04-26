import React from 'react';
import './ResultsScreen.css';
import type { ScoreState, GameNote } from '../types';
import type { InstrumentProfile } from '../Instrument';

interface ResultsScreenProps {
  score: ScoreState;
  totalNotes: number;
  notes: GameNote[];
  noteResults: Map<number, 'hit' | 'miss'>;
  instrument: InstrumentProfile;
  songTitle: string;
  onPlayAgain: () => void;
  onBackToTracks: () => void;
}

/**
 * End-of-song modal. Shows aggregate accuracy + per-string breakdown derived
 * from the noteResults map.
 */
export default function ResultsScreen({
  score,
  totalNotes,
  notes,
  noteResults,
  instrument,
  songTitle,
  onPlayAgain,
  onBackToTracks,
}: ResultsScreenProps) {
  const accuracy = totalNotes > 0 ? Math.round((score.hits / totalNotes) * 100) : 0;
  const tier = accuracy >= 85 ? 'gold' : accuracy >= 60 ? 'silver' : 'bronze';

  // Compute per-string hit / total
  const perString: { hits: number; total: number }[] = instrument.tuningsHz.map(() => ({
    hits: 0,
    total: 0,
  }));
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    if (n.string >= 0 && n.string < perString.length) {
      perString[n.string].total += 1;
      if (noteResults.get(i) === 'hit') perString[n.string].hits += 1;
    }
  }

  return (
    <div className="results-backdrop">
      <div className="results-card">
        <h2 className="results-title">Done!</h2>
        <p className="results-song">{songTitle}</p>

        <div className={`accuracy-circle accuracy-${tier}`}>
          <div className="accuracy-pct">{accuracy}%</div>
          <div className="accuracy-label">Accuracy</div>
        </div>

        <div className="results-stats">
          <div className="result-stat">
            <div className="result-label">Hits</div>
            <div className="result-value hits">
              {score.hits}
              <span className="of-total">/ {totalNotes}</span>
            </div>
          </div>
          <div className="result-stat">
            <div className="result-label">Misses</div>
            <div className="result-value misses">{score.misses}</div>
          </div>
          <div className="result-stat">
            <div className="result-label">Best combo</div>
            <div className={`result-value combo ${score.bestCombo >= 10 ? 'big' : ''}`}>
              ×{score.bestCombo}
            </div>
          </div>
          <div className="result-stat">
            <div className="result-label">Score</div>
            <div className="result-value score">{score.score}</div>
          </div>
        </div>

        <div className="per-string-section">
          <h3>Per string</h3>
          <ul className="per-string-list">
            {perString.map((row, idx) => {
              if (row.total === 0) return null;
              const pct = Math.round((row.hits / row.total) * 100);
              const color = instrument.stringColors[idx];
              const label = instrument.stringLabels[idx];
              return (
                <li key={idx} className="per-string-row">
                  <span className="ps-label" style={{ color }}>
                    {label}
                  </span>
                  <div className="ps-bar">
                    <div
                      className="ps-bar-fill"
                      style={{
                        width: `${pct}%`,
                        background: color,
                        boxShadow: `0 0 8px ${color}`,
                      }}
                    />
                  </div>
                  <span className="ps-numbers">
                    {row.hits}/{row.total} · {pct}%
                  </span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="results-actions">
          <button className="back-btn" onClick={onBackToTracks}>
            ← Track setup
          </button>
          <button className="play-again-btn" onClick={onPlayAgain}>
            ▶ Play again
          </button>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import './HUD.css';
import type { ScoreState, Difficulty } from '../types';

interface HUDProps {
  score: ScoreState;
  difficulty: Difficulty;
  isPlaying: boolean;
  onPause: () => void;
  onPlay: () => void;
  onStop: () => void;
  songTitle: string;
  songArtist?: string;
  onDifficultyChange: (d: Difficulty) => void;
  currentTimeSec: number;
  totalTimeSec: number;
  playbackRate: number;
  onPlaybackRateChange: (rate: number) => void;
  kidsMode: boolean;
  onKidsModeChange: (v: boolean) => void;
  waitMode: boolean;
  onWaitModeChange: (v: boolean) => void;
}

const RATE_PRESETS = [0.5, 0.75, 1.0];

export default function HUD({
  score,
  difficulty,
  isPlaying,
  onPause,
  onPlay,
  onStop,
  songTitle,
  songArtist,
  onDifficultyChange,
  currentTimeSec,
  totalTimeSec,
  playbackRate,
  onPlaybackRateChange,
  kidsMode,
  onKidsModeChange,
  waitMode,
  onWaitModeChange,
}: HUDProps) {
  return (
    <div className="hud">
      <div className="hud-section hud-song">
        <div className="hud-title" title={songTitle}>{songTitle}</div>
        {songArtist && <div className="hud-artist">{songArtist}</div>}
      </div>

      <div className="hud-section hud-stats">
        <div className="stat">
          <div className="stat-label">Score</div>
          <div className="stat-value">{score.score}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Combo</div>
          <div className="stat-value combo">×{score.combo}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Accuracy</div>
          <div className="stat-value">
            {score.hits + score.misses > 0
              ? `${Math.round((score.hits / (score.hits + score.misses)) * 100)}%`
              : '—'}
          </div>
        </div>
      </div>

      <div className="hud-section hud-controls">
        <div className="speed-group" title="Playback speed">
          {RATE_PRESETS.map((rate) => (
            <button
              key={rate}
              className={`speed-btn ${Math.abs(playbackRate - rate) < 0.01 ? 'active' : ''}`}
              onClick={() => onPlaybackRateChange(rate)}
            >
              {rate < 1 ? `${Math.round(rate * 100)}%` : '1×'}
            </button>
          ))}
        </div>

        <select
          className="difficulty-select"
          value={difficulty}
          onChange={(e) => onDifficultyChange(e.target.value as Difficulty)}
          disabled={isPlaying}
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="strict">Strict</option>
        </select>

        <button
          className={`kids-btn ${kidsMode ? 'active' : ''}`}
          onClick={() => onKidsModeChange(!kidsMode)}
          title="Kids Mode — chord reduction + 0–5 fret only"
        >
          🧒 Kids
        </button>

        <button
          className={`wait-btn ${waitMode ? 'active' : ''}`}
          onClick={() => onWaitModeChange(!waitMode)}
          title="Training Mode — song pauses on each note until you play it"
        >
          🎯 Training
        </button>

        {isPlaying ? (
          <button className="hud-btn pause" onClick={onPause}>⏸ Pause</button>
        ) : (
          <button className="hud-btn play" onClick={onPlay}>▶ Play</button>
        )}
        <button className="hud-btn stop" onClick={onStop}>⏹ Stop</button>

        <div className="hud-time">
          {formatTime(currentTimeSec)} / {formatTime(totalTimeSec)}
        </div>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const mins = Math.floor(s / 60);
  const secs = Math.floor(s % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

import React, { useEffect, useRef, useState } from 'react';
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
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsRef = useRef<HTMLDivElement>(null);

  // Close the popover when clicking outside.
  useEffect(() => {
    if (!optionsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (!optionsRef.current?.contains(e.target as Node)) setOptionsOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [optionsOpen]);

  // Show the active option summary on the trigger button so the user
  // can see at-a-glance what's enabled without opening the popover.
  const triggerSummary: string[] = [];
  if (kidsMode) triggerSummary.push('🧒');
  if (waitMode) triggerSummary.push('🎯');
  if (Math.abs(playbackRate - 1) > 0.01) {
    triggerSummary.push(`${Math.round(playbackRate * 100)}%`);
  }

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
        {isPlaying ? (
          <button className="hud-btn pause" onClick={onPause}>⏸ Pause</button>
        ) : (
          <button className="hud-btn play" onClick={onPlay}>▶ Play</button>
        )}
        <button className="hud-btn stop" onClick={onStop}>⏹ Stop</button>

        <div className="hud-options" ref={optionsRef}>
          <button
            className={`hud-options-btn ${optionsOpen ? 'open' : ''} ${triggerSummary.length ? 'has-active' : ''}`}
            onClick={() => setOptionsOpen((v) => !v)}
            title="Game options — speed, difficulty, Kids Mode, Training Mode"
            aria-expanded={optionsOpen}
          >
            ⚙ Options
            {triggerSummary.length > 0 && (
              <span className="hud-options-summary">{triggerSummary.join(' ')}</span>
            )}
          </button>
          {optionsOpen && (
            <>
              {/* Backdrop only meaningful on mobile (centred modal); on
                  desktop it's invisible because the popover is anchored
                  to the button and the backdrop would over-darken. */}
              <div
                className="hud-options-backdrop"
                onClick={() => setOptionsOpen(false)}
              />
              <div className="hud-options-popover" role="dialog">
              <div className="hud-option-row">
                <span className="hud-option-label">Speed</span>
                <div className="speed-group">
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
              </div>

              <div className="hud-option-row">
                <span className="hud-option-label">Difficulty</span>
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
              </div>

              <div className="hud-option-row">
                <span className="hud-option-label">Modes</span>
                <div className="hud-option-toggles">
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
                </div>
              </div>
              </div>
            </>
          )}
        </div>

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

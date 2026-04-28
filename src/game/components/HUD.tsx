import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['game', 'common']);
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
          <div className="stat-label">{t('game:score')}</div>
          <div className="stat-value">{score.score}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('game:combo')}</div>
          <div className="stat-value combo">×{score.combo}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{t('game:accuracy')}</div>
          <div className="stat-value">
            {score.hits + score.misses > 0
              ? `${Math.round((score.hits / (score.hits + score.misses)) * 100)}%`
              : '—'}
          </div>
        </div>
      </div>

      <div className="hud-section hud-controls">
        {isPlaying ? (
          <button className="hud-btn pause" onClick={onPause}>{t('common:pause_button')}</button>
        ) : (
          <button className="hud-btn play" onClick={onPlay}>{t('common:play_button')}</button>
        )}
        <button className="hud-btn stop" onClick={onStop}>{t('common:stop_button')}</button>

        <div className="hud-options" ref={optionsRef}>
          <button
            className={`hud-options-btn ${optionsOpen ? 'open' : ''} ${triggerSummary.length ? 'has-active' : ''}`}
            onClick={() => setOptionsOpen((v) => !v)}
            title={t('common:options_title')}
            aria-expanded={optionsOpen}
          >
            ⚙ {t('common:options_title')}
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
                <span className="hud-option-label">{t('common:speed_label')}</span>
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
                <span className="hud-option-label">{t('common:difficulty_label')}</span>
                <select
                  className="difficulty-select"
                  value={difficulty}
                  onChange={(e) => onDifficultyChange(e.target.value as Difficulty)}
                  disabled={isPlaying}
                >
                  <option value="easy">{t('common:difficulty_easy')}</option>
                  <option value="medium">{t('common:difficulty_medium')}</option>
                  <option value="strict">{t('common:difficulty_strict')}</option>
                </select>
              </div>

              <div className="hud-option-row">
                <span className="hud-option-label">{t('common:modes_label')}</span>
                <div className="hud-option-toggles">
                  <button
                    className={`kids-btn ${kidsMode ? 'active' : ''}`}
                    onClick={() => onKidsModeChange(!kidsMode)}
                    title={t('common:kids_mode_title')}
                  >
                    {t('common:kids_mode')}
                  </button>
                  <button
                    className={`wait-btn ${waitMode ? 'active' : ''}`}
                    onClick={() => onWaitModeChange(!waitMode)}
                    title={t('common:training_mode_title')}
                  >
                    {t('common:training_mode')}
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

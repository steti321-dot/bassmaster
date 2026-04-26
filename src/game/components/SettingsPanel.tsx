import React from 'react';
import './SettingsPanel.css';
import { DIFFICULTIES } from '../types';
import type { Difficulty } from '../types';

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  difficulty: Difficulty;
  latencyOffsetMs: number;
  onLatencyOffsetChange: (ms: number) => void;
  customPitchToleranceCents: number | undefined;
  onCustomPitchToleranceChange: (cents: number | undefined) => void;
}

/**
 * Settings drawer — slides in from the right. Adjusts:
 * - Latency offset for input round-trip compensation
 * - Pitch tolerance override (otherwise uses difficulty preset)
 */
export default function SettingsPanel({
  open,
  onClose,
  difficulty,
  latencyOffsetMs,
  onLatencyOffsetChange,
  customPitchToleranceCents,
  onCustomPitchToleranceChange,
}: SettingsPanelProps) {
  if (!open) return null;
  const presetCents = DIFFICULTIES[difficulty].pitchToleranceCents;
  const usingCustom = customPitchToleranceCents !== undefined;

  return (
    <>
      <div className="settings-backdrop" onClick={onClose} />
      <aside className="settings-drawer">
        <header className="settings-header">
          <h2>Advanced settings</h2>
          <button className="close-btn" onClick={onClose} aria-label="Close settings">
            ✕
          </button>
        </header>

        <section className="settings-section">
          <label className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">Latency offset</span>
              <span className="settings-value">{latencyOffsetMs > 0 ? '+' : ''}{latencyOffsetMs} ms</span>
            </div>
            <input
              type="range"
              min={-200}
              max={200}
              step={5}
              value={latencyOffsetMs}
              onChange={(e) => onLatencyOffsetChange(parseInt(e.target.value, 10))}
              className="settings-slider"
            />
            <p className="settings-hint">
              Compensates for audio interface / mic round-trip delay. Positive
              values shift the timing window earlier (your audio arrives late).
            </p>
            <button
              className="reset-link"
              onClick={() => onLatencyOffsetChange(0)}
              disabled={latencyOffsetMs === 0}
            >
              Reset to 0
            </button>
          </label>
        </section>

        <section className="settings-section">
          <label className="settings-row">
            <div className="settings-row-head">
              <span className="settings-label">Pitch tolerance</span>
              <span className="settings-value">
                ±{usingCustom ? customPitchToleranceCents : presetCents} ¢
              </span>
            </div>
            <div className="settings-toggle-row">
              <label className="settings-mini">
                <input
                  type="radio"
                  name="pitch-tol-mode"
                  checked={!usingCustom}
                  onChange={() => onCustomPitchToleranceChange(undefined)}
                />
                Use {difficulty} preset (±{presetCents} ¢)
              </label>
              <label className="settings-mini">
                <input
                  type="radio"
                  name="pitch-tol-mode"
                  checked={usingCustom}
                  onChange={() => onCustomPitchToleranceChange(presetCents)}
                />
                Custom
              </label>
            </div>
            <input
              type="range"
              min={5}
              max={300}
              step={5}
              value={usingCustom ? customPitchToleranceCents : presetCents}
              onChange={(e) =>
                onCustomPitchToleranceChange(parseInt(e.target.value, 10))
              }
              className="settings-slider"
              disabled={!usingCustom}
            />
            <p className="settings-hint">
              Higher = more forgiving (almost-correct notes still register).
              Lower = strict (only spot-on intonation scores).
            </p>
          </label>
        </section>

        <footer className="settings-footer">
          <span className="settings-foot-note">
            Settings save per-song automatically.
          </span>
        </footer>
      </aside>
    </>
  );
}

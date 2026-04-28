import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Setup.css';
import CalibrationWizard from '../game/components/CalibrationWizard';
import { loadCalibration, saveCalibration } from '../game/calibration';
import type { CalibrationData } from '../game/calibration';
import { loadPrefs, savePrefs } from '../game/userPrefs';
import { MicCapture } from '../game/MicCapture';

/**
 * Setup tab: home for global, infrequent settings — calibration,
 * language, mic preferences. Per-song playmode controls (difficulty,
 * speed, kids/training) stay in the in-game HUD.
 */
export default function Setup() {
  const { t, i18n } = useTranslation(['setup', 'common']);

  // ── Calibration state ─────────────────────────────────────────────
  const [calibration, setCalibration] = useState<CalibrationData | null>(() => loadCalibration());
  const [wizardOpen, setWizardOpen] = useState(false);

  const handleClearCalibration = () => {
    if (!calibration) return;
    if (!window.confirm(t('setup:clear_calibration_confirm'))) return;
    try { localStorage.removeItem('bassmaster_cal_v1'); } catch {}
    setCalibration(null);
  };

  const handleLatencySlider = (newMs: number) => {
    if (!calibration) return;
    const updated: CalibrationData = { ...calibration, latencyOffsetMs: newMs };
    saveCalibration(updated);
    setCalibration(updated);
  };

  // ── Language ──────────────────────────────────────────────────────
  const handleLanguageChange = async (lng: string) => {
    await i18n.changeLanguage(lng);
  };

  // ── Mic preferences ───────────────────────────────────────────────
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const handleNoiseSuppressToggle = (checked: boolean) => {
    const next = { ...prefs, noiseSuppressDefault: checked };
    setPrefs(next);
    savePrefs(next);
  };

  // Mic test meter — opens mic on mount, releases on unmount
  const [micRms, setMicRms] = useState(0);
  const [micActive, setMicActive] = useState(false);
  const ctxRef = useRef<AudioContext | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const rafRef = useRef<number | null>(null);

  const startMicTest = async () => {
    try {
      if (!ctxRef.current) {
        ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      if (ctxRef.current.state === 'suspended') {
        await ctxRef.current.resume();
      }
      if (!micRef.current) {
        micRef.current = new MicCapture(ctxRef.current);
      }
      micRef.current.setMonitorMuted(true);
      micRef.current.setMonitorVolume(0);
      await micRef.current.start({ noiseSuppression: prefs.noiseSuppressDefault });
      setMicActive(true);

      const tick = () => {
        const snap = micRef.current?.snapshot();
        if (snap) setMicRms(snap.rms);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.warn('[setup] mic test start failed:', err);
    }
  };

  const stopMicTest = () => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    micRef.current?.stop();
    micRef.current = null;
    if (ctxRef.current) {
      void ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    setMicActive(false);
    setMicRms(0);
  };

  // Release the mic when the tab unmounts (App switches to another tab)
  useEffect(() => {
    return () => stopMicTest();
  }, []);

  return (
    <div className="setup-screen">
      <div className="setup-card-list">
        <h2 className="setup-title">⚙️ {t('setup:title')}</h2>

        {/* Calibration & latency */}
        <section className="setup-card">
          <h3 className="setup-card-title">{t('setup:calibration_section')}</h3>
          <p className="setup-card-status">
            {calibration
              ? t('setup:calibration_status_done', {
                  instrument: calibration.instrument,
                  date: new Date(calibration.calibratedAt).toLocaleDateString(),
                })
              : t('setup:calibration_status_none')}
          </p>
          <div className="setup-card-actions">
            <button className="setup-primary-btn" onClick={() => setWizardOpen(true)}>
              {calibration ? t('setup:recalibrate') : t('setup:start_calibration')}
            </button>
            {calibration && (
              <button className="setup-secondary-btn" onClick={handleClearCalibration}>
                {t('setup:clear_calibration')}
              </button>
            )}
          </div>

          {calibration && (
            <div className="setup-slider-block">
              <div className="setup-slider-head">
                <span className="setup-slider-label">{t('setup:latency_offset')}</span>
                <span className="setup-slider-value">
                  {calibration.latencyOffsetMs > 0 ? '+' : ''}{calibration.latencyOffsetMs} ms
                </span>
              </div>
              <input
                type="range"
                min={-250}
                max={250}
                step={5}
                value={calibration.latencyOffsetMs}
                onChange={(e) => handleLatencySlider(parseInt(e.target.value, 10))}
                className="setup-slider"
              />
              <p className="setup-hint">{t('setup:latency_offset_hint')}</p>
              <button
                className="setup-link-btn"
                onClick={() => handleLatencySlider(0)}
                disabled={calibration.latencyOffsetMs === 0}
              >
                {t('common:reset')}
              </button>
            </div>
          )}
        </section>

        {/* Language */}
        <section className="setup-card">
          <h3 className="setup-card-title">{t('setup:language_section')}</h3>
          <select
            value={i18n.language}
            onChange={(e) => handleLanguageChange(e.target.value)}
            className="setup-lang-select"
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="it">Italiano</option>
            <option value="pt">Português</option>
          </select>
        </section>

        {/* Mic preferences */}
        <section className="setup-card">
          <h3 className="setup-card-title">{t('setup:mic_section')}</h3>

          <label className="setup-checkbox-row">
            <input
              type="checkbox"
              checked={prefs.noiseSuppressDefault}
              onChange={(e) => handleNoiseSuppressToggle(e.target.checked)}
            />
            <span>{t('setup:default_noise_suppress')}</span>
          </label>
          <p className="setup-hint">{t('setup:default_noise_suppress_hint')}</p>

          <div className="setup-mic-test">
            <div className="setup-slider-head">
              <span className="setup-slider-label">{t('setup:mic_test')}</span>
              {!micActive ? (
                <button className="setup-link-btn" onClick={startMicTest}>
                  {t('setup:start_mic_test')}
                </button>
              ) : (
                <button className="setup-link-btn" onClick={stopMicTest}>
                  {t('setup:stop_mic_test')}
                </button>
              )}
            </div>
            <div className="setup-rms-track">
              <div
                className="setup-rms-fill"
                style={{ width: `${Math.min(100, Math.sqrt(micRms) * 220)}%` }}
              />
            </div>
          </div>
        </section>
      </div>

      {wizardOpen && (
        <CalibrationWizard
          onApply={(data) => {
            setCalibration(data);
            setWizardOpen(false);
          }}
          onClose={() => setWizardOpen(false)}
        />
      )}
    </div>
  );
}

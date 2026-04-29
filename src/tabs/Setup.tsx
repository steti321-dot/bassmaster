import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './Setup.css';
import CalibrationWizard from '../game/components/CalibrationWizard';
import { loadCalibration, saveCalibration } from '../game/calibration';
import type { CalibrationData } from '../game/calibration';
import { loadPrefs, savePrefs } from '../game/userPrefs';
import { MicCapture } from '../game/MicCapture';
import { MEDIUM_SOUNDFONT, HIGH_SOUNDFONT_OPTIONS, DEFAULT_HIGH_KEY } from '../game/soundfontManifest';
import type { SynthQuality } from '../game/soundfontManifest';
import { isSoundFontCached, fetchAndCacheSoundFont } from '../game/soundfontCache';

const LANG_NAMES: Record<string, string> = {
  en: 'English', de: 'Deutsch', fr: 'Français',
  es: 'Español', it: 'Italiano', pt: 'Português',
};

export default function Setup() {
  const { t, i18n } = useTranslation(['setup', 'common']);

  const [openCards, setOpenCards] = useState<Record<string, boolean>>({});
  const toggleCard = (key: string) =>
    setOpenCards(prev => ({ ...prev, [key]: !prev[key] }));

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

  // ── Sound quality ─────────────────────────────────────────────────
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [selectedHighKey, setSelectedHighKey] = useState(
    () => loadPrefs().highSoundFontKey || DEFAULT_HIGH_KEY
  );

  type DlState = 'idle' | 'downloading' | 'done' | 'error';
  const [dlState, setDlState] = useState<Record<string, DlState>>({});
  const [dlProgress, setDlProgress] = useState<Record<string, number>>({});
  const [cached, setCached] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const results: Record<string, boolean> = {};
      for (const opt of HIGH_SOUNDFONT_OPTIONS) {
        results[opt.key] = await isSoundFontCached(opt.key);
      }
      setCached(results);
    })();
  }, []);

  const handleQualitySelect = (q: SynthQuality) => {
    const next = { ...prefs, synthQuality: q };
    setPrefs(next);
    savePrefs(next);
  };

  const handleHighKeyChange = (key: string) => {
    setSelectedHighKey(key);
    const next = { ...prefs, highSoundFontKey: key };
    setPrefs(next);
    savePrefs(next);
  };

  const handleDownloadHigh = async (key: string) => {
    const opt = HIGH_SOUNDFONT_OPTIONS.find((o) => o.key === key);
    if (!opt) return;
    setDlState((s) => ({ ...s, [key]: 'downloading' }));
    setDlProgress((p) => ({ ...p, [key]: 0 }));
    try {
      await fetchAndCacheSoundFont(opt.key, opt.url, (fraction) => {
        setDlProgress((p) => ({ ...p, [key]: fraction }));
      });
      setCached((c) => ({ ...c, [key]: true }));
      setDlState((s) => ({ ...s, [key]: 'done' }));
    } catch (e) {
      console.error('[setup] soundfont download failed:', e);
      setDlState((s) => ({ ...s, [key]: 'error' }));
    }
  };

  // ── Mic preferences ───────────────────────────────────────────────
  const handleNoiseSuppressToggle = (checked: boolean) => {
    const next = { ...prefs, noiseSuppressDefault: checked };
    setPrefs(next);
    savePrefs(next);
  };

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

  useEffect(() => {
    return () => stopMicTest();
  }, []);

  // ── Card header helper ────────────────────────────────────────────
  function CardHeader({
    id, title, summary,
  }: { id: string; title: string; summary?: string }) {
    const isOpen = openCards[id] ?? false;
    return (
      <div
        className={`setup-card-header${isOpen ? ' open' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => toggleCard(id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleCard(id); } }}
        aria-expanded={isOpen}
      >
        <h3 className="setup-card-title">{title}</h3>
        {!isOpen && summary && <span className="setup-card-summary">{summary}</span>}
        <span className={`setup-card-chevron${isOpen ? ' open' : ''}`}>›</span>
      </div>
    );
  }

  return (
    <div className="setup-screen">
      <div className="setup-card-list">
        <h2 className="setup-title">⚙️ {t('setup:title')}</h2>

        {/* Calibration & latency */}
        <section className="setup-card">
          <CardHeader
            id="calibration"
            title={t('setup:calibration_section')}
            summary={calibration ? calibration.instrument.toUpperCase() : undefined}
          />
          {(openCards['calibration'] ?? false) && (
            <div className="setup-card-body">
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
            </div>
          )}
        </section>

        {/* Language */}
        <section className="setup-card">
          <CardHeader
            id="language"
            title={t('setup:language_section')}
            summary={LANG_NAMES[i18n.language] ?? i18n.language}
          />
          {(openCards['language'] ?? false) && (
            <div className="setup-card-body">
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
            </div>
          )}
        </section>

        {/* Sound quality */}
        <section className="setup-card">
          <CardHeader
            id="quality"
            title={t('setup:synth_quality_section')}
            summary={t(`setup:synth_quality_${prefs.synthQuality}_label`)}
          />
          {(openCards['quality'] ?? false) && (
            <div className="setup-card-body">
              <p className="setup-hint">{t('setup:synth_quality_hint')}</p>
              <div className="setup-quality-options">

                {/* Simple */}
                <label className={`setup-quality-option${prefs.synthQuality === 'simple' ? ' selected' : ''}`}>
                  <input type="radio" name="synthQuality" value="simple"
                    checked={prefs.synthQuality === 'simple'}
                    onChange={() => handleQualitySelect('simple')} />
                  <div className="setup-quality-body">
                    <span className="setup-quality-label">{t('setup:synth_quality_simple_label')}</span>
                    <span className="setup-quality-desc">{t('setup:synth_quality_simple_desc')}</span>
                  </div>
                </label>

                {/* Medium */}
                <label className={`setup-quality-option${prefs.synthQuality === 'medium' ? ' selected' : ''}`}>
                  <input type="radio" name="synthQuality" value="medium"
                    checked={prefs.synthQuality === 'medium'}
                    onChange={() => handleQualitySelect('medium')} />
                  <div className="setup-quality-body">
                    <span className="setup-quality-label">{t('setup:synth_quality_medium_label')}</span>
                    <span className="setup-quality-desc">{t('setup:synth_quality_medium_desc')}</span>
                    <span className="setup-quality-cached">{t('setup:synth_quality_included')}</span>
                  </div>
                </label>

                {/* High */}
                {(() => {
                  const highOpt = HIGH_SOUNDFONT_OPTIONS.find((o) => o.key === selectedHighKey)!;
                  const isCached = cached[selectedHighKey] ?? false;
                  const state = dlState[selectedHighKey] ?? 'idle';
                  const isDownloading = state === 'downloading';
                  return (
                    <label
                      className={`setup-quality-option${prefs.synthQuality === 'high' ? ' selected' : ''}`}
                      style={isCached ? undefined : { cursor: 'default' }}
                    >
                      <input type="radio" name="synthQuality" value="high"
                        checked={prefs.synthQuality === 'high'}
                        disabled={!isCached}
                        onChange={() => isCached && handleQualitySelect('high')} />
                      <div className="setup-quality-body">
                        <span className="setup-quality-label">{t('setup:synth_quality_high_label')}</span>
                        <div className="setup-quality-high-row">
                          <select
                            className="setup-quality-combo"
                            value={selectedHighKey}
                            onChange={(e) => handleHighKeyChange(e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {HIGH_SOUNDFONT_OPTIONS.map((opt) => (
                              <option key={opt.key} value={opt.key}>{opt.label}</option>
                            ))}
                          </select>
                          {isCached ? (
                            <span className="setup-quality-cached">{t('setup:synth_quality_cached')}</span>
                          ) : (
                            <button
                              className="setup-quality-dl-btn"
                              disabled={isDownloading}
                              onClick={(e) => { e.preventDefault(); handleDownloadHigh(selectedHighKey); }}
                            >
                              {isDownloading
                                ? t('setup:synth_quality_downloading')
                                : t('setup:synth_quality_download', { size: highOpt.sizeMb })}
                            </button>
                          )}
                        </div>
                        {isDownloading && (
                          <div className="setup-quality-progress-bar">
                            <div className="setup-quality-progress-fill"
                              style={{ width: `${Math.round((dlProgress[selectedHighKey] ?? 0) * 100)}%` }} />
                          </div>
                        )}
                        {state === 'error' && (
                          <span className="setup-quality-error">{t('setup:synth_quality_download_error')}</span>
                        )}
                      </div>
                    </label>
                  );
                })()}

              </div>
            </div>
          )}
        </section>

        {/* Mic preferences */}
        <section className="setup-card">
          <CardHeader
            id="mic"
            title={t('setup:mic_section')}
            summary={prefs.noiseSuppressDefault ? t('common:yes') : t('common:no')}
          />
          {(openCards['mic'] ?? false) && (
            <div className="setup-card-body">
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
            </div>
          )}
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

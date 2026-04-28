import React, { useState, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import LearnGuitarGame from './tabs/LearnGuitarGame';
import Tuner from './tabs/Tuner';
import Setup from './tabs/Setup';

type Tab = 'music2notes' | 'tuner' | 'setup' | 'learn-guitar';

// Audio-to-Notes is Electron-only (Rust transcribe binary + yt-dlp). When the
// app is built for the web (REACT_APP_BUILD_TARGET=web), we skip it entirely
// — both the import (so its heavy deps don't bloat the bundle) and the tab
// button. Lazy-loading also lets the Electron build defer the chunk until
// the user actually clicks the tab.
const IS_WEB_BUILD = process.env.REACT_APP_BUILD_TARGET === 'web';
const Music2Notes = IS_WEB_BUILD
  ? null
  : lazy(() => import('./tabs/Music2Notes'));

const SHARE_URL = 'https://tinyurl.com/bassmaster52';

async function handleShare(linkCopiedMsg: string) {
  // Web Share API on mobile gives the proper share sheet (Messages,
  // WhatsApp, etc). Desktop browsers fall back to clipboard copy.
  if (typeof navigator !== 'undefined' && (navigator as any).share) {
    try {
      await (navigator as any).share({
        title: 'Bassmaster Workbench',
        text: 'Free practice tool for bass & guitar — try it!',
        url: SHARE_URL,
      });
      return;
    } catch {
      /* user cancelled or share failed — fall through to clipboard */
    }
  }
  try {
    await navigator.clipboard.writeText(SHARE_URL);
    alert(linkCopiedMsg);
  } catch {
    window.open(SHARE_URL, '_blank');
  }
}

export default function App() {
  const { t } = useTranslation(['common']);
  const [activeTab, setActiveTab] = useState<Tab>(
    IS_WEB_BUILD ? 'learn-guitar' : 'music2notes',
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-content">
          <h1>🎸 Bassmaster Workbench</h1>
          <nav className="app-tabs">
            {!IS_WEB_BUILD && (
              <button
                className={`tab-btn ${activeTab === 'music2notes' ? 'active' : ''}`}
                onClick={() => setActiveTab('music2notes')}
              >
                {t('common:tab_audio_to_notes')}
              </button>
            )}
            <button
              className={`tab-btn ${activeTab === 'tuner' ? 'active' : ''}`}
              onClick={() => setActiveTab('tuner')}
              title="Tune up before practicing"
            >
              {t('common:tab_tuner')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'setup' ? 'active' : ''}`}
              onClick={() => setActiveTab('setup')}
              title="Calibration, language, mic preferences"
            >
              {t('common:tab_setup')}
            </button>
            <button
              className={`tab-btn ${activeTab === 'learn-guitar' ? 'active' : ''}`}
              onClick={() => setActiveTab('learn-guitar')}
            >
              {t('common:tab_learn_guitar')}
            </button>
          </nav>
        </div>
      </header>

      <main className="app-main">
        {!IS_WEB_BUILD && activeTab === 'music2notes' && Music2Notes && (
          <Suspense fallback={<div className="processing">Loading…</div>}>
            <Music2Notes />
          </Suspense>
        )}
        {activeTab === 'tuner' && <Tuner />}
        {activeTab === 'setup' && <Setup />}
        {activeTab === 'learn-guitar' && <LearnGuitarGame />}
      </main>

      <footer className="app-footer">
        <p>
          {t('common:footer_privacy')}
          <span className="footer-sep">•</span>
          <a
            className="donate-link"
            href="https://ko-fi.com/bassmaster"
            target="_blank"
            rel="noreferrer"
          >
            {t('common:footer_buy_domain')}
          </a>
          <span className="footer-sep">•</span>
          <button
            type="button"
            className="share-link"
            onClick={() => handleShare(t('common:share_link_copied'))}
            title={`Share ${SHARE_URL}`}
          >
            {t('common:footer_share')}
          </button>
        </p>
      </footer>
    </div>
  );
}

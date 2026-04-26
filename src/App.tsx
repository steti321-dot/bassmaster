import React, { useState, lazy, Suspense } from 'react';
import './App.css';
import LearnGuitarGame from './tabs/LearnGuitarGame';
import Tuner from './tabs/Tuner';

type Tab = 'music2notes' | 'tuner' | 'learn-guitar';

// Audio-to-Notes is Electron-only (Rust transcribe binary + yt-dlp). When the
// app is built for the web (REACT_APP_BUILD_TARGET=web), we skip it entirely
// — both the import (so its heavy deps don't bloat the bundle) and the tab
// button. Lazy-loading also lets the Electron build defer the chunk until
// the user actually clicks the tab.
const IS_WEB_BUILD = process.env.REACT_APP_BUILD_TARGET === 'web';
const Music2Notes = IS_WEB_BUILD
  ? null
  : lazy(() => import('./tabs/Music2Notes'));

export default function App() {
  const [activeTab, setActiveTab] = useState<Tab>(
    IS_WEB_BUILD ? 'learn-guitar' : 'music2notes',
  );

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-content">
          <h1>🎸 Guitar Workbench</h1>
          <nav className="app-tabs">
            {!IS_WEB_BUILD && (
              <button
                className={`tab-btn ${activeTab === 'music2notes' ? 'active' : ''}`}
                onClick={() => setActiveTab('music2notes')}
              >
                🎵 Audio to Notes
              </button>
            )}
            <button
              className={`tab-btn ${activeTab === 'tuner' ? 'active' : ''}`}
              onClick={() => setActiveTab('tuner')}
              title="Tune up before practicing"
            >
              🎚️ Tuner
            </button>
            <button
              className={`tab-btn ${activeTab === 'learn-guitar' ? 'active' : ''}`}
              onClick={() => setActiveTab('learn-guitar')}
            >
              🎮 Learn Guitar Game
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
        {activeTab === 'learn-guitar' && <LearnGuitarGame />}
      </main>

      <footer className="app-footer">
        <p>All audio processing happens locally • No data is uploaded</p>
      </footer>
    </div>
  );
}

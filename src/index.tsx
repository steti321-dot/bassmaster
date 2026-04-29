import React from 'react';
import ReactDOM from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import App from './App';
import { resources } from './locales';

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'tuner', 'game', 'calibration', 'setup', 'music2notes'],
    nsSeparator: ':',
    keySeparator: ':',
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    supportedLngs: ['en', 'de', 'fr', 'es', 'it', 'pt'],
    interpolation: {
      escapeValue: false,
    },
    react: {
      // Resources are synchronous now, so Suspense isn't needed.
      useSuspense: false,
    },
  });

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

import React from 'react';
import ReactDOM from 'react-dom/client';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import HttpBackend from 'i18next-http-backend';
import App from './App';

i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: 'en',
    defaultNS: 'common',
    ns: ['common', 'tuner', 'game', 'calibration', 'setup'],
    nsSeparator: ':',
    keySeparator: ':',
    backend: {
      loadPath: './locales/{{lng}}/{{ns}}.json',
    },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    supportedLngs: ['en', 'de', 'fr', 'es', 'it', 'pt'],
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
  });

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
root.render(
  <React.StrictMode>
    <React.Suspense fallback={<div className="loading">Loading translations...</div>}>
      <App />
    </React.Suspense>
  </React.StrictMode>
);

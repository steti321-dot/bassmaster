import React from 'react';
import { useTranslation } from 'react-i18next';
import './About.css';
import packageJson from '../../package.json';

const IS_WEB_BUILD = process.env.REACT_APP_BUILD_TARGET === 'web';

interface LibEntry {
  name: string;
  license: string;
  descKey: string;
  url: string;
  electronOnly?: boolean;
}

const LIBS: LibEntry[] = [
  { name: 'alphaTab', license: 'LGPL 2.1', descKey: 'lib_alphatab_desc', url: 'https://alphatab.net' },
  { name: 'React', license: 'MIT', descKey: 'lib_react_desc', url: 'https://react.dev' },
  { name: 'i18next / react-i18next', license: 'MIT', descKey: 'lib_i18next_desc', url: 'https://www.i18next.com' },
  { name: 'Bravura (SMuFL font)', license: 'SIL OFL 1.1', descKey: 'lib_bravura_desc', url: 'https://github.com/steinbergmedia/bravura' },
  { name: 'Spotify Basic Pitch', license: 'Apache 2.0', descKey: 'lib_basicpitch_desc', url: 'https://basicpitch.spotify.com', electronOnly: true },
  { name: '@ffmpeg/ffmpeg', license: 'LGPL 2.1', descKey: 'lib_ffmpeg_desc', url: 'https://ffmpegwasm.netlify.app', electronOnly: true },
  { name: 'yt-dlp', license: 'Unlicense', descKey: 'lib_ytdlp_desc', url: 'https://github.com/yt-dlp/yt-dlp', electronOnly: true },
];

export default function About() {
  const { t } = useTranslation(['about']);
  const visibleLibs = LIBS.filter(l => !l.electronOnly || !IS_WEB_BUILD);

  return (
    <div className="about-screen">
      <div className="about-content">

        <section className="about-card">
          <h2 className="about-card-title">🎸 Bassmaster Workbench</h2>
          <div className="about-version-row">
            <span className="about-version">v{packageJson.version}</span>
            <span className="about-build-badge">
              {IS_WEB_BUILD ? t('about:build_web') : t('about:build_desktop')}
            </span>
          </div>
        </section>

        <section className="about-card">
          <h3 className="about-section-title">{t('about:thanks_section')}</h3>
          <table className="about-table">
            <tbody>
              <tr>
                <td className="about-lib-name">
                  <a href="https://www.guitar-pro.com" target="_blank" rel="noreferrer">Guitar Pro</a>
                </td>
                <td className="about-lib-desc">{t('about:thanks_guitarpro')}</td>
              </tr>
              <tr>
                <td className="about-lib-name">
                  <a href="https://gprotab.net" target="_blank" rel="noreferrer">gprotab.net</a>
                </td>
                <td className="about-lib-desc">{t('about:thanks_gprotab')}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="about-card">
          <h3 className="about-section-title">{t('about:libraries_section')}</h3>
          <table className="about-table">
            <thead>
              <tr>
                <th className="about-th">{t('about:libraries_section')}</th>
                <th className="about-th">{t('about:license_col')}</th>
                <th className="about-th">{t('about:description_col')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleLibs.map(lib => (
                <tr key={lib.name}>
                  <td className="about-lib-name">
                    <a href={lib.url} target="_blank" rel="noreferrer">{lib.name}</a>
                    {lib.electronOnly && (
                      <span className="about-electron-badge">{t('about:electron_only')}</span>
                    )}
                  </td>
                  <td className="about-lib-license">{lib.license}</td>
                  <td className="about-lib-desc">{t(`about:${lib.descKey}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

      </div>
    </div>
  );
}

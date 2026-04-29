/**
 * i18n resources — all 6 languages × 6 namespaces bundled into the JS
 * so we don't depend on a runtime fetch backend.
 *
 * Why bundled:
 *   - In production Electron the renderer loads from `file://`. With
 *     `webSecurity: true` (the default) plus a strict production CSP
 *     (`connect-src 'self'`), `i18next-http-backend`'s fetch to
 *     `./locales/...` is blocked. Bundling avoids the runtime fetch
 *     entirely.
 *   - For the web build the savings are marginal (one less round-trip),
 *     but the simpler code path is worth it.
 *   - Total payload across 6 langs × ~6 ns ≈ 18 KB gzipped — negligible
 *     vs the existing 391 KB main bundle.
 *
 * To add a language: drop a folder here, add 6 JSON files, register in
 * the resources map below.
 */

import en_common from './en/common.json';
import en_tuner from './en/tuner.json';
import en_game from './en/game.json';
import en_calibration from './en/calibration.json';
import en_setup from './en/setup.json';
import en_music2notes from './en/music2notes.json';

import de_common from './de/common.json';
import de_tuner from './de/tuner.json';
import de_game from './de/game.json';
import de_calibration from './de/calibration.json';
import de_setup from './de/setup.json';
import de_music2notes from './de/music2notes.json';

import fr_common from './fr/common.json';
import fr_tuner from './fr/tuner.json';
import fr_game from './fr/game.json';
import fr_calibration from './fr/calibration.json';
import fr_setup from './fr/setup.json';
import fr_music2notes from './fr/music2notes.json';

import es_common from './es/common.json';
import es_tuner from './es/tuner.json';
import es_game from './es/game.json';
import es_calibration from './es/calibration.json';
import es_setup from './es/setup.json';
import es_music2notes from './es/music2notes.json';

import it_common from './it/common.json';
import it_tuner from './it/tuner.json';
import it_game from './it/game.json';
import it_calibration from './it/calibration.json';
import it_setup from './it/setup.json';
import it_music2notes from './it/music2notes.json';

import pt_common from './pt/common.json';
import pt_tuner from './pt/tuner.json';
import pt_game from './pt/game.json';
import pt_calibration from './pt/calibration.json';
import pt_setup from './pt/setup.json';
import pt_music2notes from './pt/music2notes.json';

export const resources = {
  en: { common: en_common, tuner: en_tuner, game: en_game, calibration: en_calibration, setup: en_setup, music2notes: en_music2notes },
  de: { common: de_common, tuner: de_tuner, game: de_game, calibration: de_calibration, setup: de_setup, music2notes: de_music2notes },
  fr: { common: fr_common, tuner: fr_tuner, game: fr_game, calibration: fr_calibration, setup: fr_setup, music2notes: fr_music2notes },
  es: { common: es_common, tuner: es_tuner, game: es_game, calibration: es_calibration, setup: es_setup, music2notes: es_music2notes },
  it: { common: it_common, tuner: it_tuner, game: it_game, calibration: it_calibration, setup: it_setup, music2notes: it_music2notes },
  pt: { common: pt_common, tuner: pt_tuner, game: pt_game, calibration: pt_calibration, setup: pt_setup, music2notes: pt_music2notes },
} as const;

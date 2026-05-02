/**
 * Global, non-calibration user preferences. One record, persisted in
 * localStorage. Calibration lives in its own key (`bassmaster_cal_v1`);
 * this file is for everything else that's app-wide rather than per-song.
 */

import type { SynthQuality } from './soundfontManifest';
import { DEFAULT_HIGH_KEY } from './soundfontManifest';

export interface UserPrefs {
  /** Default value for the noise-suppression toggle in new game/tuner sessions. */
  noiseSuppressDefault: boolean;
  /** Backing-track synthesizer quality. 'simple' = built-in oscillators (default).
   *  'medium' = SONiVOX (bundled). 'high' = user-selected downloadable SF2. */
  synthQuality: SynthQuality;
  /** Key of the selected downloadable SF2 for the 'high' quality tier. */
  highSoundFontKey: string;
  /** Show karaoke-style lyric strip during play. On by default; hidden on
   *  mobile portrait regardless via CSS. */
  showLyrics: boolean;
}

const KEY = 'bassmaster_prefs_v1';

const DEFAULTS: UserPrefs = {
  noiseSuppressDefault: false,
  synthQuality: 'simple',
  highSoundFontKey: DEFAULT_HIGH_KEY,
  showLyrics: true,
};

export function loadPrefs(): UserPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<UserPrefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(p: UserPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {}
}

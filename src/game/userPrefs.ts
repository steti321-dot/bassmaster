/**
 * Global, non-calibration user preferences. One record, persisted in
 * localStorage. Calibration lives in its own key (`bassmaster_cal_v1`);
 * this file is for everything else that's app-wide rather than per-song.
 */

export interface UserPrefs {
  /** Default value for the noise-suppression toggle in new game/tuner sessions. */
  noiseSuppressDefault: boolean;
}

const KEY = 'bassmaster_prefs_v1';

const DEFAULTS: UserPrefs = {
  noiseSuppressDefault: false,
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

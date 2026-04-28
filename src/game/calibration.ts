export interface CalibrationData {
  noiseFloorRms: number;
  rmsGate: number;
  attackFloor: number;
  latencyOffsetMs: number;
  instrument: 'guitar' | 'bass' | 'unknown';
  lowStringHz: number;
  highStringHz: number;
  calibratedAt: string;
}

const KEY = 'bassmaster_cal_v1';

export function loadCalibration(): CalibrationData | null {
  try {
    const s = localStorage.getItem(KEY);
    return s ? (JSON.parse(s) as CalibrationData) : null;
  } catch { return null; }
}

export function saveCalibration(c: CalibrationData): void {
  try { localStorage.setItem(KEY, JSON.stringify(c)); } catch {}
}

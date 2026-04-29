export type SynthQuality = 'simple' | 'medium' | 'high';

export interface SoundFontDef {
  key: string;
  url: string;
  sizeMb: number;
  label: string;
}

// SONiVOX — ships inside @coderline/alphatab and is copied to /soundfont/ by
// the alphatab-webpack plugin. Always available; auto-fetched on first use.
export const MEDIUM_SOUNDFONT: SoundFontDef = {
  key: 'sf2-sonivox',
  url: `${process.env.PUBLIC_URL || ''}/soundfont/sonivox.sf2`,
  sizeMb: 4,
  label: 'SONiVOX GM (4 MB)',
};

// Downloadable GM banks. The user picks one via a combo-box in Setup.
export const HIGH_SOUNDFONT_OPTIONS: SoundFontDef[] = [
  {
    key: 'sf2-creative-8mb',
    url: 'https://archive.org/download/free-soundfonts-sf2-2019-04/CREATIVE_8MBGM.SF2',
    sizeMb: 8,
    label: 'Creative 8 MB GM',
  },
  {
    key: 'sf2-creative-28mb',
    url: 'https://archive.org/download/free-soundfonts-sf2-2019-04/CREATIVE_28MBGM.sf2',
    sizeMb: 28,
    label: 'Creative 28 MB GM',
  },
];

export const DEFAULT_HIGH_KEY = HIGH_SOUNDFONT_OPTIONS[0].key;

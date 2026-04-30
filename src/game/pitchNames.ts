// Locale-aware MIDI → pitch-name conversion.
//
// English convention: ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
// German convention:  natural B is called H. (B♭ would technically just be 'B' in German,
// but we keep 'A#' for accidentals to avoid ambiguity with the natural-B → H rename.)
//
// Other supported locales (fr, es, it, pt) all use English-style note names.

const NAMES_EN = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const NAMES_DE = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];

export function midiToPitchName(midi: number, lang: string = 'en'): string {
  const names = lang.toLowerCase().startsWith('de') ? NAMES_DE : NAMES_EN;
  const note = names[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

/**
 * GP3/GP4 file reader — produces a Song from a binary buffer.
 *
 * Mirrors the writer in cli/src/gp4.rs (see also dGuitar GP4 spec at
 * https://dguitar.sourceforge.net/GP4format.html). v1 supports the subset
 * Tab 1 emits + a tolerant parser for hand-edited / GP3 files in the wild.
 *
 * Returns notes positioned in milliseconds with fret/string/frequency.
 */

import type { Song, GameNote } from './types';
import { fretToHz, BASS, GUITAR, buildProfileFromTuning } from './Instrument';
import type { InstrumentProfile, InstrumentKind } from './Instrument';
import { parseGpWithAlphatab, inspectGpWithAlphatab } from './AlphatabReader';

/** Peek the major version from the header without advancing the main parser. */
function peekMajorVersion(bytes: Uint8Array): number {
  if (bytes.length < 32) return 0;
  const len = bytes[0];
  const text = new TextDecoder('latin1').decode(bytes.subarray(1, 1 + Math.min(len, 30)));
  const m = text.match(/v(\d+)\.\d+/);
  return m ? parseInt(m[1], 10) : 0;
}

class Reader {
  private view: DataView;
  private buf: Uint8Array;
  pos = 0;

  constructor(buf: Uint8Array) {
    this.buf = buf;
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  byte(): number {
    return this.buf[this.pos++];
  }

  int8(): number {
    return this.view.getInt8(this.pos++);
  }

  short(): number {
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  int(): number {
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** GP "byte string": 1-byte length then bytes; padded to fixed total slot size. */
  byteString(slotSize: number): string {
    const len = this.byte();
    const start = this.pos;
    this.pos += slotSize;
    return this.decode(this.buf.subarray(start, start + Math.min(len, slotSize)));
  }

  /** GP "int+byte string": int length (size-1), then 1-byte length, then bytes. */
  intByteString(): string {
    const total = this.int();
    if (total <= 0) return '';
    const byteLen = this.byte();
    const start = this.pos;
    this.pos += total - 1;
    return this.decode(this.buf.subarray(start, start + byteLen));
  }

  skip(n: number): void {
    this.pos += n;
  }

  private decode(b: Uint8Array): string {
    return new TextDecoder('latin1').decode(b);
  }

  remaining(): number {
    return this.buf.length - this.pos;
  }
}

interface MeasureHeader {
  numerator: number;
  denominator: number;
  hasMarker: boolean;
  hasKeySig: boolean;
  hasDoubleBar: boolean;
  startRepeat: boolean;
  endRepeat: number;
  alternateEndings: number;
  // Tempo for this measure (carries forward from previous if not explicitly set)
  tempo: number;
}

interface TrackInfo {
  name: string;
  stringMidi: number[];
  channel1: number;
  channel2: number;
  fretCount: number;
  isDrums: boolean;
}

/**
 * Map a General MIDI program number (0–127) to a human-readable instrument name.
 * Covers the patches you'd actually see in tab files; falls back to "Program N" otherwise.
 */
export function midiProgramName(program: number): string {
  // 0-indexed General MIDI bank
  const NAMES: Record<number, string> = {
    0: 'Acoustic Grand Piano',
    24: 'Acoustic Nylon Guitar',
    25: 'Acoustic Steel Guitar',
    26: 'Electric Jazz Guitar',
    27: 'Electric Clean Guitar',
    28: 'Electric Muted Guitar',
    29: 'Overdriven Guitar',
    30: 'Distortion Guitar',
    31: 'Guitar Harmonics',
    32: 'Acoustic Bass',
    33: 'Electric Bass (Finger)',
    34: 'Electric Bass (Pick)',
    35: 'Fretless Bass',
    36: 'Slap Bass 1',
    37: 'Slap Bass 2',
    38: 'Synth Bass 1',
    39: 'Synth Bass 2',
    40: 'Violin',
    48: 'String Ensemble',
    52: 'Choir Aahs',
    56: 'Trumpet',
    65: 'Alto Sax',
    73: 'Flute',
  };
  return NAMES[program] ?? `Program ${program}`;
}

/** Public track-info shape used by the song picker. */
export interface GpTrackInfo {
  index: number;
  name: string;
  stringCount: number;
  midiTunings: number[];
  instrument: InstrumentKind;
}

export interface GpFileSummary {
  title: string;
  artist: string;
  tempo: number;
  numMeasures: number;
  tracks: GpTrackInfo[];
}

/** Read just the header + track metadata, no notes. Cheap and fast. */
export function inspectGpFile(bytes: Uint8Array): GpFileSummary {
  // GP5+ goes through alphatab. Hand-rolled parser handles GP3/GP4 fast path,
  // but falls back to alphatab when our parser hits unsupported chord/effect
  // bytes (well-formed files in the wild often use shapes we don't model).
  const major = peekMajorVersion(bytes);
  if (major >= 5) return inspectGpWithAlphatab(bytes);
  try {
    return parseGpFileInner(bytes, undefined, { headerOnly: true }) as unknown as GpFileSummary;
  } catch (err) {
    console.warn('[Gp4Reader] inspect: hand-rolled parser failed, falling back to alphatab:', err);
    return inspectGpWithAlphatab(bytes);
  }
}

interface ParseOptions {
  trackIndex?: number;
  headerOnly?: boolean;
}

/**
 * Parse a GP3 or GP4 file into a Song. If trackIndex is provided, returns
 * notes from that specific track. Otherwise picks the first track matching
 * `instrumentHint`, or the first track overall.
 */
export function parseGpFile(
  bytes: Uint8Array,
  instrumentHint?: InstrumentKind,
  trackIndex?: number
): Song {
  const major = peekMajorVersion(bytes);
  if (major >= 5) return parseGpWithAlphatab(bytes, instrumentHint, trackIndex);
  try {
    return parseGpFileInner(bytes, instrumentHint, { trackIndex }) as Song;
  } catch (err) {
    console.warn('[Gp4Reader] parse: hand-rolled parser failed, falling back to alphatab:', err);
    return parseGpWithAlphatab(bytes, instrumentHint, trackIndex);
  }
}

function parseGpFileInner(
  bytes: Uint8Array,
  instrumentHint?: InstrumentKind,
  options: ParseOptions = {}
): Song | GpFileSummary {
  const r = new Reader(bytes);

  // Version block: 1-byte length + 30-byte slot
  const version = r.byteString(30);
  const major = parseVersion(version);

  if (major < 3 || major > 4) {
    throw new Error(`Unsupported GP version: "${version}". Only v3 and v4 are supported.`);
  }

  // Metadata strings — same count (8) for GP3 and GP4. Field names differ
  // semantically but byte layout is identical.
  const title = r.intByteString();
  const _subtitle = r.intByteString();
  const artist = r.intByteString();
  const _album = r.intByteString();
  const _author = r.intByteString(); // "songwriter" in GP4
  const _copyright = r.intByteString();
  const _tabAuthor = r.intByteString();
  const _instructions = r.intByteString();

  // Notice lines
  const noticeCount = r.int();
  for (let i = 0; i < noticeCount; i++) r.intByteString();

  // GP3: shuffleFeel (bool); GP4: tripletFeel (byte)
  if (major >= 4) {
    r.byte(); // tripletFeel
  } else {
    r.byte(); // shuffleFeel as a boolean byte
  }

  // GP4 only: lyrics (track + 5 lines)
  if (major >= 4) {
    r.int(); // associated track
    for (let i = 0; i < 5; i++) {
      r.int(); // measure start
      r.intByteString(); // lyrics line text
    }
  }

  let songTempo = r.int();

  // Key signature: int (GP3) or 1+1 byte (GP4)
  if (major >= 4) {
    r.int8(); // key
    r.byte(); // minor flag
  } else {
    r.int(); // key
  }

  // GP4: octave byte
  if (major >= 4) {
    r.byte();
  }

  // MIDI channels: 64 channels × 12 bytes (program int + 7 effect bytes + 1 padding)
  const channelPrograms: number[] = [];
  for (let i = 0; i < 64; i++) {
    const program = r.int(); // program number (GM patch)
    channelPrograms.push(program);
    r.skip(8); // volume, balance, chorus, reverb, phaser, tremolo, blank, blank
  }

  const numMeasures = r.int();
  const numTracks = r.int();

  // Read measure headers
  const measureHeaders: MeasureHeader[] = [];
  let lastNumerator = 4;
  let lastDenominator = 4;
  let lastTempo = songTempo;

  for (let i = 0; i < numMeasures; i++) {
    const flags = r.byte();
    if (flags & 0x01) lastNumerator = r.byte();
    if (flags & 0x02) lastDenominator = r.byte();
    const startRepeat = (flags & 0x04) !== 0;
    let endRepeat = 0;
    if (flags & 0x08) endRepeat = r.byte();
    let alternateEndings = 0;
    if (flags & 0x10) alternateEndings = r.byte();
    let hasMarker = false;
    if (flags & 0x20) {
      // marker: int+byte string + color (4 bytes)
      r.intByteString();
      r.skip(4);
      hasMarker = true;
    }
    if (flags & 0x40) {
      r.byte(); // key
      r.byte(); // minor flag
    }
    const hasDoubleBar = (flags & 0x80) !== 0;

    measureHeaders.push({
      numerator: lastNumerator,
      denominator: lastDenominator,
      hasMarker,
      hasKeySig: (flags & 0x40) !== 0,
      hasDoubleBar,
      startRepeat,
      endRepeat,
      alternateEndings,
      tempo: lastTempo,
    });
  }

  // Read track definitions
  const tracks: TrackInfo[] = [];
  for (let t = 0; t < numTracks; t++) {
    const trackFlags = r.byte(); // bit 0 = drums, bit 1 = 12-string, bit 2 = banjo
    const name = r.byteString(40);
    const numStrings = r.int();
    const tunings: number[] = [];
    for (let s = 0; s < 7; s++) {
      const note = r.int();
      if (s < numStrings) tunings.push(note);
    }
    const channel1 = r.int();
    const channel2 = r.int();
    r.int(); // effect channel
    const fretCount = r.int();
    r.int(); // capo
    r.skip(4); // color RGB + padding

    // Drum tracks are flagged on the track byte, OR routed to MIDI channel 10 (1-indexed).
    const isDrums = (trackFlags & 0x01) !== 0 || channel1 === 10;
    tracks.push({ name, stringMidi: tunings, channel1, channel2, fretCount, isDrums });
  }

  // Build the public track info list (used by header-only mode and the picker)
  const trackInfoList: GpTrackInfo[] = tracks.map((t, idx) => {
    const isBass = t.stringMidi.length <= 4;
    const programIdx = Math.max(0, t.channel1 - 1); // GP channels are 1-indexed
    const program = channelPrograms[programIdx] ?? -1;
    const programLabel = program >= 0 ? midiProgramName(program) : 'Unknown';
    return {
      index: idx,
      name: t.name + (programLabel && programLabel !== 'Unknown' ? ` — ${programLabel}` : ''),
      stringCount: t.stringMidi.length,
      midiTunings: t.stringMidi,
      instrument: isBass ? 'bass' : 'guitar',
    };
  });

  if (options.headerOnly) {
    // Wrong return type at TS level, but the public wrapper casts it.
    return {
      title: title || 'Untitled',
      artist: artist || '',
      tempo: songTempo,
      numMeasures,
      tracks: trackInfoList,
    } as unknown as Song;
  }

  // Pick a track: explicit index > instrument hint > first
  let chosenTrackIdx = 0;
  if (typeof options.trackIndex === 'number' && options.trackIndex >= 0 && options.trackIndex < tracks.length) {
    chosenTrackIdx = options.trackIndex;
  } else if (instrumentHint) {
    const expectedStrings = instrumentHint === 'bass' ? 4 : 6;
    const matchIdx = tracks.findIndex((t) => t.stringMidi.length === expectedStrings);
    if (matchIdx >= 0) chosenTrackIdx = matchIdx;
  }
  const chosen = tracks[chosenTrackIdx];
  if (!chosen) throw new Error('GP file has no tracks');

  // Per-track instrument profiles built from the FILE's tuning so drop tunings,
  // 5-string bass, 7-string guitar etc. produce correct frequencies. Falls back
  // to canonical BASS/GUITAR when the file has no tuning data (drum tracks).
  const trackKinds: InstrumentKind[] = tracks.map((t) =>
    t.stringMidi.length > 0 && t.stringMidi.length <= 4 ? 'bass' : 'guitar'
  );
  const trackProfiles: InstrumentProfile[] = tracks.map((t, i) =>
    t.stringMidi.length > 0
      ? buildProfileFromTuning(t.stringMidi, trackKinds[i])
      : trackKinds[i] === 'bass' ? BASS : GUITAR
  );

  // Collect notes for ALL tracks so the game can offer them as backing.
  const trackNotes: GameNote[][] = tracks.map(() => []);
  let timeMs = 0;

  for (let m = 0; m < numMeasures; m++) {
    const header = measureHeaders[m];
    const measureDurationMs =
      (60000.0 / header.tempo) * 4 * (header.numerator / header.denominator);

    for (let t = 0; t < numTracks; t++) {
      const trackProfile = trackProfiles[t];
      const trackTimeStart = timeMs; // beats are written sequentially per track per measure
      const numBeats = r.int();
      let beatTime = trackTimeStart;
      let lastDuration = 1; // quarter note default

      for (let b = 0; b < numBeats; b++) {
        const beatRead = readBeat(r, major, lastDuration, header.tempo, trackProfile);
        lastDuration = beatRead.duration;

        // Drum tracks: keep beat timing for their notes too, but skip frequency
        // (drums don't have meaningful string/fret pitch).
        for (const n of beatRead.notes) {
          trackNotes[t].push({
            time: beatTime,
            duration: beatRead.durationMs,
            string: n.stringIdx,
            fret: n.fret,
            frequency: tracks[t].isDrums
              ? 0
              : fretToHz(trackProfile, n.stringIdx, n.fret),
            finger: n.finger,
          });
        }
        beatTime += beatRead.durationMs;
      }
    }

    timeMs += measureDurationMs;
  }

  // Build SongTrack[] using the per-track names already in trackInfoList
  const songTracks = tracks.map((t, idx) => ({
    index: idx,
    name: trackInfoList[idx].name,
    instrument: trackKinds[idx],
    isDrums: t.isDrums,
    notes: trackNotes[idx],
    tuning: t.stringMidi.slice(),
  }));

  // By default, every non-player track is enabled as backing — including drums
  // (we now have a drum synth). For single-track files there's nothing else to
  // hear, so default the player track on too, otherwise pressing Play does nothing.
  const backingEnabled = new Set<number>();
  for (let i = 0; i < songTracks.length; i++) {
    if (i === chosenTrackIdx) continue;
    backingEnabled.add(i);
  }
  if (backingEnabled.size === 0) {
    backingEnabled.add(chosenTrackIdx);
  }

  return {
    title: title || 'Untitled',
    artist: artist || undefined,
    tempo: songTempo,
    tracks: songTracks,
    playerTrackIndex: chosenTrackIdx,
    backingEnabled,
    notes: songTracks[chosenTrackIdx].notes,
    instrument: trackKinds[chosenTrackIdx],
  };
}

function parseVersion(version: string): number {
  // Handles: "FICHIER GUITAR PRO v3.00" → 3, "FICHIER GUITAR PRO v4.06" → 4
  const m = version.match(/v(\d+)\.\d+/);
  return m ? parseInt(m[1], 10) : 0;
}

interface BeatRead {
  /** Encoded duration value (-2..4). */
  duration: number;
  /** Beat duration in milliseconds. */
  durationMs: number;
  notes: { stringIdx: number; fret: number; finger?: number }[];
}

function readBeat(
  r: Reader,
  major: number,
  prevDuration: number,
  tempo: number,
  profile: InstrumentProfile
): BeatRead {
  const flags = r.byte();
  if (flags & 0x40) {
    r.byte(); // beat status (rest / empty)
  }

  const duration = r.int8();
  let tupletDivisor = 1;
  let tupletMultiplier = 1;
  if (flags & 0x20) {
    const tuplet = r.int();
    if (tuplet === 3) {
      tupletDivisor = 3;
      tupletMultiplier = 2;
    } else if (tuplet === 5) {
      tupletDivisor = 5;
      tupletMultiplier = 4;
    } else if (tuplet === 6) {
      tupletDivisor = 6;
      tupletMultiplier = 4;
    } else if (tuplet === 7) {
      tupletDivisor = 7;
      tupletMultiplier = 4;
    }
  }

  if (flags & 0x02) skipChord(r, major);
  if (flags & 0x04) r.intByteString(); // text
  if (flags & 0x08) skipBeatEffects(r, major);
  if (flags & 0x10) skipMixTable(r, major);

  // Compute beat duration in ms.
  // Duration value: -2=whole, -1=half, 0=quarter, 1=eighth, 2=16th, 3=32nd, 4=64th
  const beatFraction = Math.pow(2, -duration); // -2 → 4 (whole = 4 quarters)
  const dotted = (flags & 0x01) !== 0;
  const dottedMul = dotted ? 1.5 : 1.0;
  const tupletAdjust = tupletMultiplier / tupletDivisor;
  const quarterMs = 60000 / tempo;
  const durationMs = beatFraction * quarterMs * dottedMul * tupletAdjust;

  // String mask: bit 6 = string 0 (highest), bit 1 = string 5 (lowest for guitar)
  const stringMask = r.byte();
  const numStrings = profile.tuningsHz.length;
  const beatNotes: { stringIdx: number; fret: number; finger?: number }[] = [];
  for (let s = 0; s < 7; s++) {
    if (stringMask & (1 << (6 - s))) {
      const note = readNote(r, major);
      // Filter implausible frets (negative = no fret, >30 = sentinel byte
      // from a malformed/tied note that we don't model fully).
      if (s < numStrings && note.fret >= 0 && note.fret <= 30) {
        beatNotes.push({ stringIdx: s, fret: note.fret, finger: note.finger });
      }
    }
  }

  return { duration, durationMs, notes: beatNotes };
}

function readNote(r: Reader, major: number): { fret: number; finger?: number } {
  const noteFlags = r.byte();
  if (noteFlags & 0x20) r.byte(); // note type (1=normal, 2=tie, 3=dead)
  if (noteFlags & 0x01) {
    r.byte(); // dotted (deprecated in GP4)
    r.byte(); // tuplet
  }
  if (noteFlags & 0x10) r.byte(); // dynamics
  let fret = -1;
  if (noteFlags & 0x20) fret = r.byte();
  let finger: number | undefined = undefined;
  if (noteFlags & 0x80) {
    const leftHand = r.int8(); // -1 = none, 0=thumb, 1=index, 2=middle, 3=ring, 4=pinky
    r.int8(); // right hand (not used for guitar/bass game)
    if (leftHand >= 0 && leftHand <= 4) finger = leftHand;
  }
  if (noteFlags & 0x08) skipNoteEffects(r, major);
  return { fret, finger };
}

function skipChord(r: Reader, major: number): void {
  // Two formats coexist within GP4: "old" (header byte 0) vs "new" (header byte 1).
  // GP3 always uses the simpler old format.
  if (major >= 4) {
    const header = r.byte();
    if (header === 1) {
      // New (extended) chord format
      r.byte(); // sharp
      r.skip(3); // padding
      r.byte(); // root
      r.byte(); // chord type
      r.byte(); // chord extension (9th/11th/13th)
      r.int(); // bass note
      r.int(); // tonality
      r.byte(); // add note flag
      r.byteString(34); // chord name slot
      r.byte(); // 5th tonality
      r.byte(); // 9th tonality
      r.byte(); // 11th tonality
      r.int(); // base fret
      for (let s = 0; s < 7; s++) r.int(); // fret per string
      r.byte(); // num barres
      r.skip(5); // barre frets
      r.skip(5); // barre start
      r.skip(5); // barre end
      r.skip(7); // omission flags
      r.skip(1); // padding
      r.skip(7); // fingering
      r.byte(); // show diagonal fingering
    } else {
      // Old chord format: name + base fret + 6 fret values
      r.byteString(34); // name
      r.int(); // base fret
      if (r.int() > 0) {
        for (let s = 0; s < 6; s++) r.int();
      }
    }
  } else {
    // GP3 chord
    r.byteString(34); // name
    r.int(); // base fret
    if (r.int() > 0) {
      for (let s = 0; s < 6; s++) r.int();
    }
  }
}

function skipBeatEffects(r: Reader, major: number): void {
  const flags1 = r.byte();
  let flags2 = 0;
  if (major >= 4) flags2 = r.byte();

  if (flags1 & 0x20) {
    if (major >= 4) {
      r.byte(); // tap/slap/pop type (1=tap, 2=slap, 3=pop)
    } else {
      // GP3: combined effect byte includes vibrato/wide-vibrato + tremolo bar via int
      const effect = r.byte();
      r.int(); // bend value (legacy combined field)
      void effect;
    }
  }
  if (flags2 & 0x04) skipTremoloBar(r, major);
  if (flags1 & 0x40) {
    r.byte(); // stroke up
    r.byte(); // stroke down
  }
  if (flags2 & 0x02) r.byte(); // pickstroke
}

function skipTremoloBar(r: Reader, _major: number): void {
  r.byte(); // type
  r.int(); // value
  const points = r.int();
  for (let i = 0; i < points; i++) {
    r.int();
    r.int();
    r.byte();
  }
}

function skipMixTable(r: Reader, major: number): void {
  // Each value is a signed byte: -1 means "no change", anything else is the new value.
  // After the value block, a duration byte follows for each value that DID change
  // (including tempo, but excluding instrument).
  r.int8(); // instrument (no duration byte)
  const volume = r.int8();
  const pan = r.int8();
  const chorus = r.int8();
  const reverb = r.int8();
  const phaser = r.int8();
  const tremolo = r.int8();
  const tempo = r.int(); // 4-byte int

  if (volume >= 0) r.byte();
  if (pan >= 0) r.byte();
  if (chorus >= 0) r.byte();
  if (reverb >= 0) r.byte();
  if (phaser >= 0) r.byte();
  if (tremolo >= 0) r.byte();
  if (tempo >= 0) r.byte();

  if (major >= 4) {
    r.byte(); // "apply-to-all-tracks" mask
  }
}

function skipNoteEffects(r: Reader, major: number): void {
  const flags1 = r.byte();
  let flags2 = 0;
  if (major >= 4) flags2 = r.byte();

  if (flags1 & 0x01) skipBend(r);
  if (flags1 & 0x10) {
    r.byte(); // grace fret
    r.byte(); // grace dynamic
    r.byte(); // grace transition
    r.byte(); // grace duration
  }
  if (flags2 & 0x04) {
    r.byte(); // tremolo picking duration
  }
  if (flags2 & 0x08) r.byte(); // slide type
  if (flags2 & 0x10) {
    r.byte(); // harmonic type
  }
  if (flags2 & 0x20) {
    r.byte(); // trill fret
    r.byte(); // trill duration
  }
}

function skipBend(r: Reader): void {
  r.byte(); // type
  r.int(); // value
  const points = r.int();
  for (let i = 0; i < points; i++) {
    r.int();
    r.int();
    r.byte();
  }
}

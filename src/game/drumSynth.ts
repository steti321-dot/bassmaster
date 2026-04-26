/**
 * Web Audio drum synth — kick, snare, hi-hat, tom, crash, ride.
 * Each voice is a small graph of oscillators / noise / filters with a quick
 * envelope. Good enough to make a drum track audibly recognisable; not a
 * sampled drum kit.
 *
 * Inputs:
 * - `midiNote` is the General MIDI drum note (channel-10 convention).
 *   GP3/GP4 store drum hits with the MIDI drum number in the "fret" field.
 */

export interface DrumScheduleResult {
  /** Audio source nodes that need to be tracked for stop(). */
  sources: AudioScheduledSourceNode[];
  /** Other nodes that need disconnecting. */
  nodes: AudioNode[];
}

/**
 * Schedule one drum hit at `startSec`, mixing into `dest`.
 * Returns the AudioNodes used so the caller can register them for cleanup.
 */
export function scheduleDrum(
  ctx: AudioContext,
  dest: AudioNode,
  noiseBuffer: AudioBuffer,
  midiNote: number,
  startSec: number
): DrumScheduleResult {
  // Map MIDI drum number → which voice to use
  if (midiNote === 35 || midiNote === 36) return playKick(ctx, dest, startSec);
  if (midiNote === 37) return playSnare(ctx, dest, noiseBuffer, startSec, 0.04, 0.18); // side stick
  if (midiNote === 38 || midiNote === 40) return playSnare(ctx, dest, noiseBuffer, startSec, 0.12, 0.32);
  if (midiNote === 39) return playSnare(ctx, dest, noiseBuffer, startSec, 0.08, 0.25); // hand clap
  if (midiNote === 42 || midiNote === 44) return playHat(ctx, dest, noiseBuffer, startSec, 0.05); // closed
  if (midiNote === 46) return playHat(ctx, dest, noiseBuffer, startSec, 0.3); // open
  if (midiNote === 49 || midiNote === 57 || midiNote === 55) return playCymbal(ctx, dest, noiseBuffer, startSec, 0.9); // crash
  if (midiNote === 51 || midiNote === 53 || midiNote === 59 || midiNote === 52) return playCymbal(ctx, dest, noiseBuffer, startSec, 1.4); // ride
  if (midiNote >= 41 && midiNote <= 50) return playTom(ctx, dest, startSec, midiNote);
  if (midiNote === 54 || midiNote === 56) return playClick(ctx, dest, startSec); // tambourine, cowbell

  // Fallback for anything else — generic percussive click
  return playClick(ctx, dest, startSec);
}

/** Pre-fill a 2s noise buffer; reused across all hits to avoid per-hit allocation. */
export function createNoiseBuffer(ctx: AudioContext): AudioBuffer {
  const len = Math.ceil(ctx.sampleRate * 2.0);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

// ─── Voices ───────────────────────────────────────────────────────────

function playKick(ctx: AudioContext, dest: AudioNode, startSec: number): DrumScheduleResult {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(150, startSec);
  osc.frequency.exponentialRampToValueAtTime(45, startSec + 0.07);

  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.linearRampToValueAtTime(0.45, startSec + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.22);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec);
  osc.stop(startSec + 0.25);
  return { sources: [osc], nodes: [gain] };
}

function playSnare(
  ctx: AudioContext,
  dest: AudioNode,
  noiseBuffer: AudioBuffer,
  startSec: number,
  decay: number,
  level: number
): DrumScheduleResult {
  // Noise component
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  noise.loop = false;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 1200;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.0001, startSec);
  noiseGain.gain.linearRampToValueAtTime(level, startSec + 0.003);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, startSec + decay);
  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(dest);
  noise.start(startSec);
  noise.stop(startSec + decay + 0.05);

  // Body tone (~200 Hz with quick pitch drop)
  const tone = ctx.createOscillator();
  const toneGain = ctx.createGain();
  tone.type = 'triangle';
  tone.frequency.setValueAtTime(280, startSec);
  tone.frequency.exponentialRampToValueAtTime(180, startSec + 0.02);
  toneGain.gain.setValueAtTime(0.0001, startSec);
  toneGain.gain.linearRampToValueAtTime(level * 0.6, startSec + 0.003);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, startSec + decay * 0.7);
  tone.connect(toneGain);
  toneGain.connect(dest);
  tone.start(startSec);
  tone.stop(startSec + decay + 0.05);

  return { sources: [noise, tone], nodes: [noiseFilter, noiseGain, toneGain] };
}

function playHat(
  ctx: AudioContext,
  dest: AudioNode,
  noiseBuffer: AudioBuffer,
  startSec: number,
  decay: number
): DrumScheduleResult {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 9000;
  bp.Q.value = 1.2;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.linearRampToValueAtTime(0.18, startSec + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, startSec + decay);
  noise.connect(hp);
  hp.connect(bp);
  bp.connect(gain);
  gain.connect(dest);
  noise.start(startSec);
  noise.stop(startSec + decay + 0.05);
  return { sources: [noise], nodes: [hp, bp, gain] };
}

function playCymbal(
  ctx: AudioContext,
  dest: AudioNode,
  noiseBuffer: AudioBuffer,
  startSec: number,
  decay: number
): DrumScheduleResult {
  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 4500;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.linearRampToValueAtTime(0.22, startSec + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startSec + decay);
  noise.connect(hp);
  hp.connect(gain);
  gain.connect(dest);
  noise.start(startSec);
  noise.stop(startSec + decay + 0.05);
  return { sources: [noise], nodes: [hp, gain] };
}

function playTom(
  ctx: AudioContext,
  dest: AudioNode,
  startSec: number,
  midiNote: number
): DrumScheduleResult {
  // MIDI 41 (low floor tom) → 50 (high tom). Map to ~80-220 Hz.
  const baseFreq = Math.max(70, 80 + (midiNote - 41) * 16);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(baseFreq * 1.6, startSec);
  osc.frequency.exponentialRampToValueAtTime(baseFreq, startSec + 0.08);

  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.linearRampToValueAtTime(0.6, startSec + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.3);

  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec);
  osc.stop(startSec + 0.32);
  return { sources: [osc], nodes: [gain] };
}

function playClick(ctx: AudioContext, dest: AudioNode, startSec: number): DrumScheduleResult {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(800, startSec);
  gain.gain.setValueAtTime(0.0001, startSec);
  gain.gain.linearRampToValueAtTime(0.25, startSec + 0.002);
  gain.gain.exponentialRampToValueAtTime(0.0001, startSec + 0.04);
  osc.connect(gain);
  gain.connect(dest);
  osc.start(startSec);
  osc.stop(startSec + 0.06);
  return { sources: [osc], nodes: [gain] };
}

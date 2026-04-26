/**
 * Schedules and plays a song's notes via Web Audio.
 *
 * Used as the in-game backing track so the player hears the melody/bass line
 * while the chips fall. Pure synthesis (oscillators + ADSR), no audio files.
 *
 * Honors a playback-rate multiplier so the slow-down buttons in the HUD
 * actually slow the audio too.
 */

import type { GameNote } from './types';
import type { InstrumentKind } from './Instrument';
import { scheduleDrum, createNoiseBuffer } from './drumSynth';

// Look-ahead scheduling window. Each scheduler tick queues the next
// LOOKAHEAD_SEC worth of audio events into Web Audio. This avoids
// pre-scheduling thousands of oscillators upfront, which chokes the
// audio engine on long multi-track songs (Creep = 5k events).
const LOOKAHEAD_SEC = 2.0;
const SCHEDULER_INTERVAL_MS = 250;

export class BackingSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  /** Compressor sits between masterGain and destination — tames peaks when
   *  many tracks/voices play simultaneously (a multi-track song easily has
   *  10+ overlapping notes whose summed amplitude blows past clipping). */
  private compressor: DynamicsCompressorNode | null = null;
  private liveNodes: AudioNode[] = [];
  private liveSources: AudioScheduledSourceNode[] = [];
  private noiseBuffer: AudioBuffer | null = null;
  private muted = false;
  private volume = 0.6;

  /** Pending event queue (sorted by absolute audio-context startSec). */
  private pending: Array<{ startSec: number; schedule: () => void }> = [];
  private pendingIdx = 0;
  private schedulerTimer: number | null = null;

  /** Lazily create the audio context (must be triggered by a user gesture). */
  private ensureContext() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();

      // Voices → masterGain → compressor → destination
      // The compressor prevents the heavy clipping you'd otherwise get when 6+
      // tracks each have multiple voices overlapping (the summed amplitude can
      // easily exceed 1.0 by a factor of 5-10×, which most audio outputs render
      // as silence rather than legible distortion).
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.muted ? 0 : this.volume;

      this.compressor = this.ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -14; // dB — start compressing here
      this.compressor.knee.value = 6;
      this.compressor.ratio.value = 8;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.1;

      this.masterGain.connect(this.compressor);
      this.compressor.connect(this.ctx.destination);

      console.log('[BackingSynth] AudioContext created, state=' + this.ctx.state);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().then(() => {
        console.log('[BackingSynth] AudioContext resumed');
      }).catch((e) => {
        console.error('[BackingSynth] AudioContext resume FAILED:', e);
      });
    }
  }

  /** Expose the AudioContext so other modules (MicCapture) can share it. */
  getContext(): AudioContext | null {
    return this.ctx;
  }

  /** Force creation of the context — useful when you want to share it before any notes play. */
  warmUp(): AudioContext {
    this.ensureContext();
    return this.ctx!;
  }

  setVolume(v: number) {
    this.volume = Math.max(0, Math.min(1, v));
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.masterGain) {
      this.masterGain.gain.value = this.muted ? 0 : this.volume;
    }
  }

  /**
   * Schedule notes from one or more tracks starting at `fromGameTimeMs`,
   * scaled by playbackRate. Cancels any previously-scheduled notes first.
   *
   * Each track is { notes, instrument } — the instrument controls timbre
   * (bass tracks get a sub-octave sine to fatten the low end).
   */
  start(
    tracks: Array<{ notes: GameNote[]; instrument: InstrumentKind; isDrums?: boolean }>,
    fromGameTimeMs: number,
    playbackRate: number
  ): void {
    this.stop();
    this.ensureContext();
    if (!this.ctx || !this.masterGain) {
      console.warn('[BackingSynth] no audio context available');
      return;
    }

    const ctx = this.ctx;
    const wallStart = ctx.currentTime + 0.1;

    const totalIncoming = tracks.reduce((s, t) => s + t.notes.length, 0);
    console.log(
      `[BackingSynth] start ctx=${ctx.state} ` +
        `tracks=${tracks.length} (${tracks.map((t) => (t.isDrums ? 'drums' : t.instrument)).join('+') || 'none'}) ` +
        `notes=${totalIncoming} fromMs=${fromGameTimeMs.toFixed(0)} rate=${playbackRate} ` +
        `vol=${this.volume} muted=${this.muted}`
    );

    if (!this.noiseBuffer) this.noiseBuffer = createNoiseBuffer(ctx);
    const noiseBuffer = this.noiseBuffer;
    const masterGain = this.masterGain;

    // Build a closure for each note that, when called, actually pushes the
    // audio nodes into Web Audio. We don't run them now — the look-ahead
    // scheduler runs them in batches as their start time approaches.
    const pending: typeof this.pending = [];
    for (const track of tracks) {
      for (const n of track.notes) {
        if (n.time + n.duration < fromGameTimeMs - 50) continue;
        const gameOffsetMs = Math.max(0, n.time - fromGameTimeMs);
        const startSec = wallStart + gameOffsetMs / 1000 / playbackRate;

        if (track.isDrums) {
          const fret = n.fret;
          pending.push({
            startSec,
            schedule: () => {
              const result = scheduleDrum(ctx, masterGain, noiseBuffer, fret, startSec);
              this.liveSources.push(...result.sources);
              this.liveNodes.push(...result.nodes);
            },
          });
        } else {
          if (n.frequency <= 0) continue;
          const freq = n.frequency;
          const durSec = Math.max(0.08, n.duration / 1000 / playbackRate);
          const inst = track.instrument;
          pending.push({
            startSec,
            schedule: () => this.scheduleNote(freq, startSec, durSec, inst),
          });
        }
      }
    }
    pending.sort((a, b) => a.startSec - b.startSec);
    this.pending = pending;
    this.pendingIdx = 0;

    // Kick off the look-ahead scheduler. tick() runs synchronously once so
    // the first audio is queued before we return; subsequent ticks fire on
    // the interval timer.
    this.tickScheduler();
    this.schedulerTimer = window.setInterval(
      () => this.tickScheduler(),
      SCHEDULER_INTERVAL_MS,
    );
  }

  /** Drain any pending events whose startSec falls within the look-ahead window. */
  private tickScheduler(): void {
    if (!this.ctx) return;
    const horizon = this.ctx.currentTime + LOOKAHEAD_SEC;
    while (this.pendingIdx < this.pending.length) {
      const ev = this.pending[this.pendingIdx];
      if (ev.startSec > horizon) break;
      try {
        ev.schedule();
      } catch (err) {
        console.warn('[BackingSynth] schedule failed:', err);
      }
      this.pendingIdx++;
    }
    // All done? Stop the timer to avoid pointless wake-ups.
    if (this.pendingIdx >= this.pending.length && this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
  }

  private scheduleNote(
    freq: number,
    startSec: number,
    durSec: number,
    instrument: InstrumentKind
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const ctx = this.ctx;

    // Two-oscillator voice for a fuller sound:
    //   - fundamental: triangle (mellow, harmonically rich enough to feel musical)
    //   - sub-octave for bass: sine 1 octave below at lower amplitude
    const fundamental = ctx.createOscillator();
    fundamental.type = 'triangle';
    fundamental.frequency.value = freq;

    const voiceGain = ctx.createGain();
    // Per-voice levels are kept modest because dozens of voices may stack;
    // the compressor handles the rest. Bass is slightly louder than guitar
    // because triangle waves are weaker at low frequencies.
    const peakGain = instrument === 'bass' ? 0.18 : 0.13;

    // ADSR envelope tuned for plucked-instrument feel
    voiceGain.gain.setValueAtTime(0, startSec);
    voiceGain.gain.linearRampToValueAtTime(peakGain, startSec + 0.012);
    voiceGain.gain.exponentialRampToValueAtTime(peakGain * 0.35, startSec + Math.min(0.18, durSec * 0.4));
    voiceGain.gain.linearRampToValueAtTime(0.0001, startSec + durSec);

    fundamental.connect(voiceGain);
    voiceGain.connect(this.masterGain);

    fundamental.start(startSec);
    fundamental.stop(startSec + durSec + 0.05);

    this.liveNodes.push(voiceGain);
    this.liveSources.push(fundamental);

    // Bass sub-octave for body. Skip if it would dip below 35 Hz (sub-audible,
    // builds up DC offset, can mute the channel on small speakers).
    if (instrument === 'bass' && freq / 2 >= 35) {
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = freq / 2;
      const subGain = ctx.createGain();
      subGain.gain.setValueAtTime(0, startSec);
      subGain.gain.linearRampToValueAtTime(0.1, startSec + 0.015);
      subGain.gain.exponentialRampToValueAtTime(0.025, startSec + Math.min(0.25, durSec * 0.5));
      subGain.gain.linearRampToValueAtTime(0.0001, startSec + durSec);
      sub.connect(subGain);
      subGain.connect(this.masterGain);
      sub.start(startSec);
      sub.stop(startSec + durSec + 0.05);
      this.liveNodes.push(subGain);
      this.liveSources.push(sub);
    }
  }

  /** Cancel all scheduled and playing notes. Safe to call repeatedly. */
  stop(): void {
    if (this.schedulerTimer !== null) {
      clearInterval(this.schedulerTimer);
      this.schedulerTimer = null;
    }
    this.pending = [];
    this.pendingIdx = 0;

    for (const src of this.liveSources) {
      try {
        src.stop();
      } catch {
        /* already stopped or never started */
      }
      try {
        src.disconnect();
      } catch {}
    }
    for (const n of this.liveNodes) {
      try {
        n.disconnect();
      } catch {}
    }
    this.liveSources = [];
    this.liveNodes = [];
  }

  /** Tear down the AudioContext entirely. Call on tab unmount. */
  dispose(): void {
    this.stop();
    if (this.ctx) {
      void this.ctx.close().catch(() => {});
      this.ctx = null;
      this.masterGain = null;
    }
  }
}

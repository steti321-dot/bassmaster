/**
 * Abstraction over backing-track synthesizers.
 *
 * SimpleSynth wraps the existing oscillator-based BackingSynth ("Simple" quality).
 * AlphaTabSynth wraps AlphaTabApi + a downloaded SF2 soundfont ("Medium"/"High").
 *
 * Both implement ISynth so LearnGuitarGame can swap them transparently.
 * AlphaTabSynth additionally exposes loadScore() / setBackingConfig() that
 * LearnGuitarGame calls via useEffect when the song or track selection changes.
 */

import * as alphaTab from '@coderline/alphatab';
import type { GameNote } from './types';
import type { InstrumentKind } from './Instrument';
import { BackingSynth } from './BackingSynth';

export type BackingTrack = { notes: GameNote[]; instrument: InstrumentKind; isDrums?: boolean };

export interface ISynth {
  warmUp(): AudioContext;
  getContext(): AudioContext | null;
  start(tracks: BackingTrack[], fromMs: number, rate: number): void;
  stop(): void;
  setVolume(v: number): void;
  setMuted(muted: boolean): void;
  dispose(): void;
  /** AlphaTabSynth only — load GP file bytes into the player. */
  loadScore?(bytes: Uint8Array, playerTrackIdx: number, backingSet: Set<number>): void;
  /** AlphaTabSynth only — update track muting without re-loading. */
  setBackingConfig?(playerTrackIdx: number, backingSet: Set<number>): void;
}

// ─── SimpleSynth ─────────────────────────────────────────────────────────────

/** Thin wrapper around BackingSynth. Behaviour is identical to the pre-SynthManager code. */
export class SimpleSynth implements ISynth {
  private inner = new BackingSynth();

  warmUp(): AudioContext { return this.inner.warmUp(); }
  getContext(): AudioContext | null { return this.inner.getContext(); }
  start(tracks: BackingTrack[], fromMs: number, rate: number): void { this.inner.start(tracks, fromMs, rate); }
  stop(): void { this.inner.stop(); }
  setVolume(v: number): void { this.inner.setVolume(v); }
  setMuted(m: boolean): void { this.inner.setMuted(m); }
  dispose(): void { this.inner.dispose(); }
}

// ─── AlphaTabSynth ───────────────────────────────────────────────────────────

/** Plays backing tracks through alphaSynth using a downloaded SF2 soundfont. */
export class AlphaTabSynth implements ISynth {
  private api: alphaTab.AlphaTabApi | null = null;
  private container: HTMLDivElement | null = null;
  private ctx: AudioContext | null = null;
  private objectUrl: string | null = null;
  // Fallback for demo songs that have no GP bytes (score never loaded).
  private fallback = new BackingSynth();

  private sfReady = false;
  private scoreReady = false;
  private volume = 0.6;
  private muted = false;
  private playerTrackIdx = 0;
  private backingSet = new Set<number>();

  constructor(sf2Bytes: Uint8Array) {
    console.log(`[AT] constructor sf2=${sf2Bytes.byteLength}`);
    const blob = new Blob([sf2Bytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    this.objectUrl = URL.createObjectURL(blob);

    this.container = document.createElement('div');
    // Off-screen — we only need the audio engine, not the visual renderer.
    this.container.style.cssText =
      'position:fixed;left:-9999px;top:-9999px;width:600px;height:200px;pointer-events:none;overflow:hidden;';
    document.body.appendChild(this.container);

    try {
      // The @coderline/alphatab-webpack plugin copies Bravura to <publicUrl>/font/.
      // alphaTab doesn't auto-detect this path, so we point it explicitly.
      const fontDir = (process.env.PUBLIC_URL || '') + '/font/';
      console.log(`[AT] fontDir=${fontDir}`);
      this.api = new alphaTab.AlphaTabApi(this.container, {
        core: { logLevel: alphaTab.LogLevel.Warning, fontDirectory: fontDir },
        player: {
          enablePlayer: true,
          soundFont: this.objectUrl,
          enableCursor: false,
          enableUserInteraction: false,
        } as any,
      });

      this.api.soundFontLoaded.on(() => {
        console.log('[AT] soundFontLoaded ✓');
        this.sfReady = true;
      });
      this.api.scoreLoaded.on(() => {
        console.log('[AT] scoreLoaded ✓');
        this.scoreReady = true;
        this.applyTrackMuting();
      });
      this.api.error.on((e: any) => {
        console.error('[AT] api.error:', e);
      });
    } catch (e) {
      console.error('[AT] init failed:', e);
    }
  }

  // ── ISynth ──────────────────────────────────────────────────────────────

  warmUp(): AudioContext {
    this.fallback.warmUp();
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  getContext(): AudioContext | null { return this.ctx; }

  start(tracks: BackingTrack[], fromMs: number, rate: number): void {
    console.log(`[AT] start sfReady=${this.sfReady} scoreReady=${this.scoreReady} fromMs=${fromMs}`);
    if (!this.api || !this.sfReady || !this.scoreReady) {
      // No GP score loaded (e.g. demo songs) — fall back to oscillator synth.
      this.fallback.start(tracks, fromMs, rate);
      return;
    }
    this.fallback.stop();
    this.api.playbackSpeed = rate;
    this.api.masterVolume = this.muted ? 0 : this.volume;

    if (fromMs > 0) {
      // Convert song-time ms to MIDI ticks (constant-tempo approximation).
      const bpm = this.api.score?.tempo ?? 120;
      const ticks = Math.round((fromMs / 1000) * (bpm / 60) * 960);
      try { this.api.tickPosition = ticks; } catch { /* not all versions support this */ }
    } else {
      try { (this.api as any).stop?.(); } catch { /* reset to beginning */ }
    }

    if (!(this.api as any).isPlaying) {
      try { (this.api as any).play?.(); } catch {
        try { this.api.playPause(); } catch { /* last resort */ }
      }
    }
  }

  stop(): void {
    this.fallback.stop();
    if (!this.api) return;
    try { this.api.pause(); } catch {
      try { (this.api as any).stop?.(); } catch {}
    }
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.fallback.setVolume(v);
    if (this.api) this.api.masterVolume = this.muted ? 0 : this.volume;
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.fallback.setMuted(m);
    if (this.api) this.api.masterVolume = this.muted ? 0 : this.volume;
  }

  dispose(): void {
    this.fallback.dispose();
    try { (this.api as any)?.destroy?.(); } catch {}
    this.api = null;
    if (this.container?.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    this.container = null;
    if (this.objectUrl) { URL.revokeObjectURL(this.objectUrl); this.objectUrl = null; }
    if (this.ctx) { void this.ctx.close().catch(() => {}); this.ctx = null; }
  }

  // ── AlphaTabSynth-specific ───────────────────────────────────────────────

  loadScore(bytes: Uint8Array, playerTrackIdx: number, backingSet: Set<number>): void {
    console.log(`[AT] loadScore bytes=${bytes.byteLength} playerTrack=${playerTrackIdx} backing=${[...backingSet]}`);
    if (!this.api) return;
    this.scoreReady = false;
    this.playerTrackIdx = playerTrackIdx;
    this.backingSet = new Set(backingSet);
    try { this.api.load(bytes as any); } catch (e) {
      console.error('[AT] load failed:', e);
    }
  }

  setBackingConfig(playerTrackIdx: number, backingSet: Set<number>): void {
    this.playerTrackIdx = playerTrackIdx;
    this.backingSet = new Set(backingSet);
    if (this.scoreReady) this.applyTrackMuting();
  }

  private applyTrackMuting(): void {
    if (!this.api?.score) return;
    const tracks = this.api.score.tracks;
    for (let i = 0; i < tracks.length; i++) {
      // Play only backing tracks; mute the player's own track.
      const shouldPlay = this.backingSet.has(i);
      try { this.api.changeTrackMute([tracks[i]], !shouldPlay); } catch {}
    }
  }
}

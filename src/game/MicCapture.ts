/**
 * Microphone capture for the game's pitch-scoring path.
 *
 * Wires:
 *   getUserMedia → MediaStreamSource ─┬─► AnalyserNode (for pitch detection)
 *                                     └─► GainNode (monitor) ─► AudioContext.destination
 *
 * The monitor gain lets the player hear themselves through the speakers
 * (or headphones/audio interface) while playing — solves the "I can't tell
 * what I'm playing" problem the user flagged earlier.
 */

export interface MicSnapshot {
  /** Raw time-domain samples in [-1, 1]. */
  samples: Float32Array;
  /** Sample rate of the AudioContext. */
  sampleRate: number;
  /** RMS level of the snapshot (rough loudness). */
  rms: number;
}

export class MicCapture {
  private ctx: AudioContext;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private analyser: AnalyserNode | null = null;
  private monitorGain: GainNode | null = null;
  private monitorLowpass: BiquadFilterNode | null = null;
  private monitorLimiter: DynamicsCompressorNode | null = null;
  private monitorVolume = 0;
  private monitorMuted = false;
  private buffer: Float32Array | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
  }

  /**
   * Request mic access and wire up the audio graph. Resolves once the
   * stream is connected and ready to be sampled. Throws if the user
   * denies permission or no input device exists.
   *
   * `noiseSuppression` toggles browser-level RNNoise. Off by default — it
   * tends to attenuate sustained tonal content (i.e. notes). Turning it
   * on helps in noisy rooms (fans, HVAC) at the cost of detection accuracy.
   */
  async start(opts: { noiseSuppression?: boolean } = {}): Promise<void> {
    if (this.stream) return; // already started

    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: opts.noiseSuppression ?? false,
        autoGainControl: false,
        channelCount: 1,
      },
      video: false,
    });

    this.source = this.ctx.createMediaStreamSource(this.stream);

    this.analyser = this.ctx.createAnalyser();
    // 16384 samples (~372 ms at 44.1 kHz) — required by the polyphonic FFT
    // detector so that adjacent semitones are resolvable even on bass (E1=41 Hz,
    // where two semitones differ by only ~2.4 Hz; 44100/16384 ≈ 2.7 Hz/bin).
    this.analyser.fftSize = 16384;
    this.analyser.smoothingTimeConstant = 0;
    this.buffer = new Float32Array(this.analyser.fftSize);

    // Monitor chain (mic → speakers) is filtered + limited to prevent feedback:
    //   source → lowpass(5kHz) → fastLimiter → monitorGain → destination
    // The lowpass kills the high-frequency squeal that mic-into-speaker loops
    // typically produce; the limiter caps any runaway transients.
    this.monitorLowpass = this.ctx.createBiquadFilter();
    this.monitorLowpass.type = 'lowpass';
    this.monitorLowpass.frequency.value = 5000;
    this.monitorLowpass.Q.value = 0.7;

    this.monitorLimiter = this.ctx.createDynamicsCompressor();
    this.monitorLimiter.threshold.value = -10;
    this.monitorLimiter.knee.value = 4;
    this.monitorLimiter.ratio.value = 20;
    this.monitorLimiter.attack.value = 0.001;
    this.monitorLimiter.release.value = 0.04;

    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = this.monitorMuted ? 0 : this.monitorVolume;

    // Source fans out to: analyser (silent, full bandwidth) + monitor (filtered)
    this.source.connect(this.analyser);
    this.source.connect(this.monitorLowpass);
    this.monitorLowpass.connect(this.monitorLimiter);
    this.monitorLimiter.connect(this.monitorGain);
    this.monitorGain.connect(this.ctx.destination);
  }

  /** Read the latest mic samples for pitch analysis. */
  snapshot(): MicSnapshot | null {
    if (!this.analyser || !this.buffer) return null;
    // Cast: TS's strict types complain about Float32Array<ArrayBufferLike> vs <ArrayBuffer>
    this.analyser.getFloatTimeDomainData(this.buffer as Float32Array<ArrayBuffer>);

    // Compute RMS over the most recent 512 samples (~12 ms) so the attack gate
    // responds snappily even though the buffer holds 372 ms for the FFT.
    const rmsWindow = 512;
    const rmsStart = this.buffer.length - rmsWindow;
    let sumSq = 0;
    for (let i = rmsStart; i < this.buffer.length; i++) {
      sumSq += this.buffer[i] * this.buffer[i];
    }
    const rms = Math.sqrt(sumSq / rmsWindow);

    return {
      samples: this.buffer,
      sampleRate: this.ctx.sampleRate,
      rms,
    };
  }

  setMonitorVolume(v: number) {
    this.monitorVolume = Math.max(0, Math.min(1, v));
    if (this.monitorGain) {
      this.monitorGain.gain.value = this.monitorMuted ? 0 : this.monitorVolume;
    }
  }

  setMonitorMuted(muted: boolean) {
    this.monitorMuted = muted;
    if (this.monitorGain) {
      this.monitorGain.gain.value = this.monitorMuted ? 0 : this.monitorVolume;
    }
  }

  isStarted(): boolean {
    return this.stream !== null;
  }

  /** Stop and re-acquire with new constraints (e.g., toggling noise suppression). */
  async restart(opts: { noiseSuppression?: boolean } = {}): Promise<void> {
    const wasStarted = this.isStarted();
    this.stop();
    if (wasStarted) await this.start(opts);
  }

  /** Tear down everything. Releases the mic. */
  stop(): void {
    if (this.source) {
      try { this.source.disconnect(); } catch {}
      this.source = null;
    }
    if (this.analyser) {
      try { this.analyser.disconnect(); } catch {}
      this.analyser = null;
    }
    if (this.monitorLowpass) {
      try { this.monitorLowpass.disconnect(); } catch {}
      this.monitorLowpass = null;
    }
    if (this.monitorLimiter) {
      try { this.monitorLimiter.disconnect(); } catch {}
      this.monitorLimiter = null;
    }
    if (this.monitorGain) {
      try { this.monitorGain.disconnect(); } catch {}
      this.monitorGain = null;
    }
    if (this.stream) {
      for (const t of this.stream.getTracks()) {
        try { t.stop(); } catch {}
      }
      this.stream = null;
    }
    this.buffer = null;
  }
}

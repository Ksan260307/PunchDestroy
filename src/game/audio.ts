/**
 * 音はすべてその場で合成する（音声ファイルを持たない）。
 * 連打するほど音が高くなるので、手応えが耳でも分かる。
 */

export class SoundKit {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private muted = false;
  private lastPlay = 0;

  get enabled(): boolean {
    return !this.muted;
  }

  /** 最初の操作のときに呼ぶ。ブラウザの制限で、それより前には鳴らせない */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    type WindowWithAudio = Window & { webkitAudioContext?: typeof AudioContext };
    const Ctor = window.AudioContext ?? (window as WindowWithAudio).webkitAudioContext;
    if (!Ctor) return;

    const ctx = new Ctor();
    const master = ctx.createGain();
    master.gain.value = 0.85;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;
    master.connect(limiter).connect(ctx.destination);

    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let seed = 0x2f6e2b1;
    for (let i = 0; i < length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      data[i] = ((seed >>> 8) / 8388608 - 1) * 0.9;
    }

    this.ctx = ctx;
    this.master = master;
    this.noise = buffer;
  }

  setMuted(value: boolean): void {
    this.muted = value;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value ? 0 : 0.85, this.ctx.currentTime, 0.02);
    }
  }

  private ready(): boolean {
    if (this.muted || !this.ctx || !this.master) return false;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return true;
  }

  private burst(
    duration: number,
    gain: number,
    filterType: BiquadFilterType,
    startFreq: number,
    endFreq: number,
    q = 1,
  ): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.value = q;
    filter.frequency.setValueAtTime(startFreq, ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, endFreq),
      ctx.currentTime + duration,
    );

    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(0.0008, ctx.currentTime + duration);

    src.connect(filter).connect(env).connect(this.master!);
    src.start();
    src.stop(ctx.currentTime + duration + 0.02);
  }

  private tone(
    type: OscillatorType,
    from: number,
    to: number,
    duration: number,
    gain: number,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(from, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), ctx.currentTime + duration);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, ctx.currentTime);
    env.gain.exponentialRampToValueAtTime(gain, ctx.currentTime + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);

    osc.connect(env).connect(this.master!);
    osc.start();
    osc.stop(ctx.currentTime + duration + 0.02);
  }

  punch(heavy: boolean, combo: number, strength: number): void {
    if (!this.ready()) return;
    const now = this.ctx!.currentTime;
    if (now - this.lastPlay < 0.012) return;
    this.lastPlay = now;

    const power = 0.5 + Math.min(1, strength) * 0.6;
    this.tone('sine', heavy ? 150 : 110, heavy ? 34 : 46, heavy ? 0.28 : 0.16, 0.5 * power);
    this.burst(heavy ? 0.3 : 0.16, 0.42 * power, 'bandpass', heavy ? 2600 : 1900, 320, 0.9);

    // 連打で音階が上がる
    const stepUp = Math.min(combo, 26);
    const pitch = 330 * Math.pow(2, stepUp / 12);
    this.tone('triangle', pitch, pitch * 1.02, 0.1, 0.09 + Math.min(0.12, combo * 0.004));
  }

  crumble(): void {
    if (!this.ready()) return;
    this.burst(0.7, 0.5, 'lowpass', 900, 90, 0.7);
    this.tone('sine', 90, 28, 0.6, 0.4);
  }

  rush(): void {
    if (!this.ready()) return;
    this.tone('sawtooth', 180, 900, 0.45, 0.22);
    this.burst(0.5, 0.35, 'highpass', 400, 5200, 0.8);
  }

  clear(): void {
    if (!this.ready()) return;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      window.setTimeout(() => {
        if (!this.ready()) return;
        this.tone('triangle', freq, freq, 0.5, 0.26);
      }, i * 110);
    });
    this.burst(1.1, 0.4, 'lowpass', 1600, 120, 0.6);
  }
}

import type { WeaponId } from '../../../shared/weapons.js';

export class AudioSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  public volume = 0.7;

  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = this.volume;
      this.masterGain.connect(this.ctx.destination);

      const len = this.ctx.sampleRate * 0.5;
      this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < len; i++) {
        data[i] = Math.random() * 2 - 1;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setVolume(vol01: number): void {
    this.volume = Math.max(0, Math.min(1, vol01));
    if (this.masterGain) {
      this.masterGain.gain.value = this.volume;
    }
  }

  private playTone(
    freqStart: number,
    freqEnd: number,
    duration: number,
    type: OscillatorType,
    gainLevel: number
  ): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this.volume <= 0.01) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), now + duration);
    g.gain.setValueAtTime(gainLevel, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration);
  }

  private playNoise(duration: number, filterFreq: number, gainLevel: number): void {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.noiseBuffer || this.volume <= 0.01) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gainLevel, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + duration);
  }

  public playWeaponFire(weapon: WeaponId, dist = 0): void {
    const maxHearing = weapon === 5 ? 8 : 65;
    if (dist > maxHearing) return;
    const atten = Math.max(0.05, 1 - dist / maxHearing);

    switch (weapon) {
      case 0: // AR
        this.playTone(220, 70, 0.09, 'sawtooth', 0.22 * atten);
        this.playNoise(0.08, 1200, 0.25 * atten);
        break;
      case 1: // SMG
        this.playTone(310, 110, 0.06, 'square', 0.16 * atten);
        this.playNoise(0.05, 1800, 0.18 * atten);
        break;
      case 2: // Shotgun
        this.playTone(130, 40, 0.16, 'sawtooth', 0.32 * atten);
        this.playNoise(0.18, 700, 0.35 * atten);
        break;
      case 3: // Revolver
        this.playTone(260, 55, 0.14, 'triangle', 0.30 * atten);
        this.playNoise(0.12, 1500, 0.32 * atten);
        break;
      case 4: // Sniper
        this.playTone(190, 35, 0.22, 'sawtooth', 0.36 * atten);
        this.playNoise(0.20, 950, 0.36 * atten);
        break;
      case 5: // Shadow Kunai (silent whistle)
        this.playNoise(0.07, 2900, 0.12 * atten);
        this.playTone(920, 480, 0.06, 'sine', 0.06 * atten);
        break;
    }
  }

  public playHitmarker(headshot: boolean): void {
    if (headshot) {
      this.playTone(1350, 1850, 0.09, 'triangle', 0.24);
    } else {
      this.playTone(720, 960, 0.06, 'sine', 0.18);
    }
  }

  public playSlide(): void {
    this.playNoise(0.28, 520, 0.14);
  }

  public playAbility(fxType: string): void {
    if (fxType === 'dash' || fxType === 'shadow_blink') {
      this.playNoise(0.14, 1600, 0.18);
      this.playTone(480, 180, 0.12, 'sine', 0.16);
    } else if (fxType === 'cloak') {
      this.playTone(620, 340, 0.22, 'sine', 0.14);
    } else if (fxType === 'recon_pulse') {
      this.playTone(340, 880, 0.28, 'sine', 0.18);
    } else if (fxType === 'stim') {
      this.playTone(300, 720, 0.22, 'triangle', 0.16);
    } else if (fxType === 'impulse_explode') {
      this.playTone(140, 32, 0.28, 'sawtooth', 0.32);
      this.playNoise(0.26, 480, 0.30);
    } else if (fxType === 'wall_spawn') {
      this.playTone(110, 165, 0.16, 'square', 0.18);
    } else if (fxType === 'smoke') {
      this.playNoise(0.35, 650, 0.16);
    }
  }

  public playSectorWarningBeep(dist: number, urgent: boolean): void {
    if (dist > 85) return;
    const atten = Math.max(0.1, 1 - dist / 85);
    this.playTone(urgent ? 980 : 660, urgent ? 880 : 620, urgent ? 0.09 : 0.14, 'square', 0.14 * atten);
  }

  public playSectorRumble(dist: number): void {
    if (dist > 95) return;
    const atten = Math.max(0.12, 1 - dist / 95);
    this.playTone(68, 42, 0.45, 'triangle', 0.22 * atten);
    this.playNoise(0.4, 220, 0.16 * atten);
  }

  public playFootstep(volumeScale = 1.0): void {
    if (volumeScale <= 0.02) return;
    this.playTone(110, 65, 0.04, 'sine', 0.06 * volumeScale);
  }
}

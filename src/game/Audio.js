/**
 * Procedural Web Audio SFX — unlocks on first user gesture.
 */
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this._unlocked = false;
    this._footstepAcc = 0;
    this._loadMute();
  }

  _loadMute() {
    try {
      this.muted = localStorage.getItem('mcfps-mute') === '1';
    } catch {
      this.muted = false;
    }
  }

  _saveMute() {
    try {
      localStorage.setItem('mcfps-mute', this.muted ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  async unlock() {
    if (this._unlocked && this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this._unlocked = true;
    // Warm-up silent blip (helps some mobile browsers)
    this._beep(20, 0.001, 'sine', 0.0001, 0.01);
  }

  setMuted(m) {
    this.muted = !!m;
    this._saveMute();
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  _now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  _beep(freq, dur, type = 'square', vol = 0.2, attack = 0.005) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this._now();
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  _noise(dur, vol = 0.15, filterFreq = 2000) {
    if (!this.ctx || !this.master || this.muted) return;
    const t = this._now();
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 0.8;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  playFire() {
    if (!this.ctx) return;
    this._noise(0.06, 0.28, 1800);
    this._beep(180 + Math.random() * 40, 0.05, 'sawtooth', 0.12, 0.001);
    this._beep(90, 0.04, 'square', 0.08, 0.001);
  }

  playEmpty() {
    this._beep(90, 0.04, 'square', 0.1, 0.001);
    this._beep(60, 0.05, 'triangle', 0.06, 0.001);
  }

  playReload() {
    if (!this.ctx) return;
    const t = this._now();
    // Metallic click sequence
    [0, 0.12, 0.35, 0.55].forEach((off, i) => {
      setTimeout(() => {
        this._beep(400 - i * 40, 0.04, 'triangle', 0.1, 0.002);
        this._noise(0.03, 0.08, 3000);
      }, off * 1000);
    });
    void t;
  }

  playHit(headshot = false) {
    if (headshot) {
      this._beep(880, 0.06, 'square', 0.15, 0.001);
      this._beep(1320, 0.08, 'sine', 0.1, 0.001);
    } else {
      this._beep(420, 0.05, 'square', 0.12, 0.001);
      this._noise(0.04, 0.1, 1200);
    }
  }

  playHurt() {
    this._beep(140, 0.12, 'sawtooth', 0.18, 0.002);
    this._noise(0.1, 0.12, 600);
  }

  playKill() {
    this._beep(523, 0.08, 'square', 0.14, 0.002);
    setTimeout(() => this._beep(784, 0.12, 'square', 0.14, 0.002), 80);
    setTimeout(() => this._beep(1046, 0.18, 'sine', 0.12, 0.002), 160);
  }

  playFootstep() {
    this._noise(0.04, 0.06, 400);
    this._beep(70 + Math.random() * 20, 0.03, 'triangle', 0.04, 0.001);
  }

  playUi() {
    this._beep(660, 0.04, 'sine', 0.08, 0.002);
  }

  /** Call each frame while moving on ground. */
  updateFootsteps(dt, speed01) {
    if (speed01 < 0.15) {
      this._footstepAcc = 0;
      return;
    }
    this._footstepAcc += dt * (0.9 + speed01 * 2.2);
    if (this._footstepAcc >= 1) {
      this._footstepAcc = 0;
      this.playFootstep();
    }
  }
}

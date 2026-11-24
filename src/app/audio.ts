/**
 * Procedural audio for Mythbound: synthesized music loops and sound effects.
 * Placeholder until real music/SFX arrive from the prompt pack, but the API stays the same.
 */

/** Flat builds (for phone uploads with no folders) keep every file beside index.html. */
const SFX_DIR = import.meta.env.VITE_FLAT ? './' : './sfx/';

export type Track = 'base' | 'free' | 'hold' | 'awake';

const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface TrackDef {
  bpm: number;
  chords: number[][];
  step(a: AudioEngine, s: number, bar: number, chord: number[], t: number, stepDur: number): void;
}

const TRACKS: Record<Track, TrackDef> = {
  // Mysterious, adventurous: Dm – Bb – C – Am
  base: {
    bpm: 92,
    chords: [[50, 53, 57], [46, 50, 53], [48, 52, 55], [45, 48, 52]],
    step(a, s, bar, chord, t, d) {
      if (s === 0) a.pad(chord.map((n) => n + 12), t, d * 16, 0.05);
      if (s === 0 || s === 8) a.bass(chord[0] - 12, t, d * 6, 0.16);
      if (s === 10) a.bass(chord[2] - 12, t, d * 4, 0.1);
      if (s % 2 === 0) a.pluck(chord[(s / 2) % 3] + 24 + (s >= 8 ? 12 : 0), t, d * 2, 0.035);
      if (s === 0 || s === 8) a.kick(t, 0.35);
      if (s % 4 === 2) a.hat(t, 0.04);
      if (s === 0 && bar % 2 === 0) a.bell(chord[2] + 24, t, 0.06);
    },
  },
  // Bright and driving: F – C – Dm – Bb, taiko drums, bell melody
  free: {
    bpm: 116,
    chords: [[53, 57, 60], [48, 52, 55], [50, 53, 57], [46, 50, 53]],
    step(a, s, bar, chord, t, d) {
      if (s === 0) a.pad(chord.map((n) => n + 12), t, d * 16, 0.06);
      if (s % 4 === 0) a.bass(chord[0] - 12, t, d * 3, 0.17);
      a.pluck(chord[s % 3] + 24 + (s % 8 >= 4 ? 12 : 0), t, d * 1.5, 0.03);
      if ([0, 3, 6, 8, 11, 14].includes(s)) a.taiko(t, s === 0 || s === 8 ? 0.5 : 0.28);
      if (s === 4 || s === 12) a.snare(t, 0.12);
      if (s % 2 === 1) a.hat(t, 0.035);
      const melody = [[72, 69, 72, 77], [72, 67, 64, 67], [69, 72, 74, 72], [70, 69, 67, 65]][bar % 4];
      if (s % 4 === 0) a.bell(melody[s / 4], t, 0.07);
    },
  },
  // Tension: low drone, heartbeat, semitone tremolo
  hold: {
    bpm: 96,
    chords: [[38, 45, 50], [38, 45, 51]],
    step(a, s, bar, chord, t, d) {
      if (s === 0) a.pad(chord, t, d * 16, 0.07);
      const beat = 0.3 + 0.12 * a.intensity;
      if (s === 0 || s === 8) a.kick(t, beat);
      if (s === 3 || s === 11) a.kick(t, beat * 0.6);
      if (s % 2 === 0) a.pluck((s % 4 === 0 ? 74 : 75) + (bar % 2), t, d * 1.2, 0.02 + 0.01 * a.intensity);
      if (a.intensity >= 2) a.hat(t, 0.03);
      if (a.intensity >= 1 && s % 4 === 2) a.hat(t, 0.05);
    },
  },
  // Awakened: heavier, war drums
  awake: {
    bpm: 104,
    chords: [[26, 33, 38], [26, 33, 39]],
    step(a, s, bar, chord, t, d) {
      if (s === 0) a.pad(chord.map((n) => n + 12), t, d * 16, 0.08);
      if (s % 4 === 0) a.bass(chord[0], t, d * 3, 0.2);
      if ([0, 2, 6, 8, 10, 14].includes(s)) a.taiko(t, s % 8 === 0 ? 0.55 : 0.3);
      if (s % 2 === 0) a.pluck((s % 4 === 0 ? 62 : 63) + 12, t, d, 0.025 + 0.01 * a.intensity);
      if (a.intensity >= 1) a.hat(t, 0.03);
      if (s === 0 && bar % 2 === 1) a.brass([50, 57, 62], t, d * 8, 0.05);
    },
  },
};

export class AudioEngine {
  ctx?: AudioContext;
  private master!: GainNode;
  private musicBus!: GainNode;
  private sfxBus!: GainNode;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private musicGain?: GainNode;
  private track: Track | null = null;
  private timer?: number;
  private nextTime = 0;
  private step = 0;
  private lastTick = 0;
  intensity = 0;
  muted = false;

  /** Must be called from a user gesture (click/tap). */
  unlock() {
    if (!this.ctx) {
      try {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        this.ctx = new Ctx();
      } catch { return; }
      const c = this.ctx;
      this.master = c.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(c.destination);
      this.musicBus = c.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);
      this.sfxBus = c.createGain();
      this.sfxBus.gain.value = 0.9;
      this.sfxBus.connect(this.master);
      this.reverb = c.createConvolver();
      this.reverb.buffer = this.impulse(2.4);
      const wet = c.createGain();
      wet.gain.value = 0.35;
      this.reverb.connect(wet).connect(this.master);
      this.noise = c.createBuffer(1, c.sampleRate, c.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      try { (navigator as Navigator & { audioSession?: { type: string } }).audioSession!.type = 'playback'; } catch { /* not supported */ }
      this.timer = window.setInterval(() => this.schedule(), 25);
      this.loadSamples();
      // Start whatever track was requested before audio was unlocked.
      const pending = this.track;
      this.track = null;
      this.music(pending);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  private impulse(seconds: number): AudioBuffer {
    const c = this.ctx!;
    const len = Math.floor(c.sampleRate * seconds);
    const buf = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  // ---------------- Music ----------------

  music(track: Track | null) {
    if (track === this.track) return;
    this.track = track;
    if (!this.ctx) return;
    const c = this.ctx, now = c.currentTime;
    if (this.musicGain) {
      const old = this.musicGain;
      old.gain.cancelScheduledValues(now);
      old.gain.setValueAtTime(old.gain.value, now);
      old.gain.linearRampToValueAtTime(0, now + 0.8);
      setTimeout(() => old.disconnect(), 1200);
    }
    this.musicGain = undefined;
    if (this.loopSrc) { const src = this.loopSrc; this.loopSrc = undefined; try { src.stop(now + 0.85); } catch { /* ignore */ } }
    if (!track) return;
    const g = c.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 0.6);
    g.connect(this.musicBus);
    this.musicGain = g;
    const loop = AudioEngine.LOOPS[track] && this.buffers.get(AudioEngine.LOOPS[track]!);
    if (loop) {
      const src = c.createBufferSource();
      src.buffer = loop;
      src.loop = true;
      const lg = c.createGain();
      lg.gain.value = 1.6; // recordings sit a little lower than the synth score
      src.connect(lg).connect(g);
      src.start(now + 0.05);
      this.loopSrc = src;
    }
    this.step = 0;
    this.nextTime = now + 0.05;
  }

  private schedule() {
    if (!this.ctx || !this.track || !this.musicGain || this.loopSrc) return;
    const def = TRACKS[this.track];
    const stepDur = 60 / def.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const s = this.step % 16;
      const bar = Math.floor(this.step / 16);
      def.step(this, s, bar, def.chords[bar % def.chords.length], this.nextTime, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  // ---------------- Instruments ----------------

  private out(music: boolean) {
    return music ? (this.musicGain ?? this.musicBus) : this.sfxBus;
  }

  private env(t: number, peak: number, attack: number, decay: number, music = true, send = 0.2): GainNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.out(music));
    if (send) {
      const s = c.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.reverb);
    }
    return g;
  }

  private osc(type: OscillatorType, freq: number, t: number, dur: number, dest: AudioNode, detune = 0) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    o.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  private noiseSrc(t: number, dur: number, dest: AudioNode) {
    const n = this.ctx!.createBufferSource();
    n.buffer = this.noise;
    n.loop = true;
    n.connect(dest);
    n.start(t, Math.random() * 0.5);
    n.stop(t + dur + 0.05);
    return n;
  }

  pad(notes: number[], t: number, dur: number, vol: number, music = true) {
    const c = this.ctx!;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1100;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + Math.min(0.5, dur * 0.3));
    g.gain.setValueAtTime(vol, t + dur * 0.75);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(this.out(music));
    const s = c.createGain();
    s.gain.value = 0.5;
    g.connect(s).connect(this.reverb);
    for (const n of notes) {
      this.osc('sawtooth', hz(n), t, dur, lp, -7);
      this.osc('sawtooth', hz(n), t, dur, lp, 7);
    }
  }

  pluck(note: number, t: number, dur: number, vol: number, music = true, type: OscillatorType = 'triangle') {
    this.osc(type, hz(note), t, dur, this.env(t, vol, 0.005, dur, music, 0.35));
  }

  bass(note: number, t: number, dur: number, vol: number) {
    const c = this.ctx!;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    lp.connect(this.env(t, vol, 0.01, dur, true, 0));
    this.osc('triangle', hz(note), t, dur, lp);
    this.osc('sine', hz(note - 12), t, dur, lp);
  }

  bell(note: number, t: number, vol: number, music = true) {
    const g = this.env(t, vol, 0.003, 1.6, music, 0.5);
    this.osc('sine', hz(note), t, 1.6, g);
    const g2 = this.env(t, vol * 0.4, 0.003, 0.7, music, 0.5);
    this.osc('sine', hz(note) * 2.76, t, 0.7, g2);
  }

  brass(notes: number[], t: number, dur: number, vol: number, music = true) {
    const c = this.ctx!;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(2800, t + 0.08);
    lp.frequency.linearRampToValueAtTime(1400, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol * 0.8, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    lp.connect(g);
    g.connect(this.out(music));
    const s = c.createGain();
    s.gain.value = 0.4;
    g.connect(s).connect(this.reverb);
    for (const n of notes) {
      this.osc('sawtooth', hz(n), t, dur, lp, -5);
      this.osc('sawtooth', hz(n), t, dur, lp, 6);
    }
  }

  kick(t: number, vol: number, music = true) {
    const g = this.env(t, vol, 0.002, 0.28, music, 0);
    const o = this.osc('sine', 150, t, 0.3, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
  }

  taiko(t: number, vol: number, music = true) {
    const g = this.env(t, vol, 0.003, 0.45, music, 0.3);
    const o = this.osc('sine', 110, t, 0.5, g);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const bp = this.ctx!.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 400;
    bp.connect(this.env(t, vol * 0.5, 0.002, 0.08, music, 0.2));
    this.noiseSrc(t, 0.1, bp);
  }

  snare(t: number, vol: number, music = true) {
    const bp = this.ctx!.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.connect(this.env(t, vol, 0.002, 0.16, music, 0.3));
    this.noiseSrc(t, 0.2, bp);
    this.osc('triangle', 190, t, 0.1, this.env(t, vol * 0.6, 0.002, 0.08, music, 0));
  }

  hat(t: number, vol: number, music = true) {
    const hp = this.ctx!.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7000;
    hp.connect(this.env(t, vol, 0.001, 0.05, music, 0));
    this.noiseSrc(t, 0.07, hp);
  }

  private sweep(t: number, dur: number, from: number, to: number, vol: number, q = 4) {
    const c = this.ctx!;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(from, t);
    bp.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    bp.connect(g);
    g.connect(this.sfxBus);
    this.noiseSrc(t, dur, bp);
  }

  // ---------------- Sound effects ----------------

  // ---- Recorded sound effects (ElevenLabs). The synth versions play until these load. ----
  private static readonly SAMPLES = {
    reel: 'reel_stop', orb: 'orb_land', spin: 'spin_start',
    win: 'line_win', tick: 'win_tick', gate: 'moon_gate', antic: 'anticipation', cell: 'cell_stop', reset: 'respin_reset',
    small: 'fanfare_small', big: 'fanfare_big', feature: 'fanfare_feature', jackpot: 'fanfare_jackpot',
    coins: 'coin_shower', thunder: 'thunder', roar: 'beast_roar',
    rumble: 'door_rumble', doorOpen: 'door_open', sticky: 'sticky_lock', special: 'special_orb',
    row: 'row_unlock', click: 'ui_click', chime: 'reward_chime',
  } as const;
  /** Recorded music loops for every track; the synth score plays only until they load. */
  private static readonly LOOPS: Partial<Record<Track, string>> = { base: 'music_base', hold: 'music_hold', free: 'music_free2', awake: 'music_awake' };
  private loopSrc?: AudioBufferSourceNode;
  private buffers = new Map<string, AudioBuffer>();

  private loadSamples() {
    const c = this.ctx!;
    for (const [track, name] of Object.entries(AudioEngine.LOOPS) as [Track, string][]) {
      fetch(new URL(`${SFX_DIR}${name}.wav`, document.baseURI).href)
        .then((r) => r.arrayBuffer())
        .then((b) => new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(b, ok, bad)))
        .then((buf) => {
          this.buffers.set(name, buf);
          // Swap the synth for the recording if this track is already playing.
          if (this.track === track && !this.loopSrc) { this.track = null; this.music(track); }
        })
        .catch(() => { /* keep the synth */ });
    }
    for (const name of Object.values(AudioEngine.SAMPLES)) {
      fetch(new URL(`${SFX_DIR}${name}.wav`, document.baseURI).href)
        .then((r) => r.arrayBuffer())
        .then((b) => new Promise<AudioBuffer>((ok, bad) => c.decodeAudioData(b, ok, bad)))
        .then((buf) => this.buffers.set(name, buf))
        .catch(() => { /* keep the synth */ });
    }
  }

  /** Plays the recorded sound for a slot; false if it hasn't loaded yet. */
  private sample(slot: keyof typeof AudioEngine.SAMPLES, t: number, rate = 1, gain = 1, offset = 0): boolean {
    const buf = this.buffers.get(AudioEngine.SAMPLES[slot]);
    if (!buf) return false;
    const c = this.ctx!;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const g = c.createGain();
    g.gain.value = gain;
    src.connect(g).connect(this.sfxBus);
    src.start(Math.max(t, c.currentTime), offset);
    return true;
  }

  private get now() { return this.ctx ? this.ctx.currentTime + 0.01 : -1; }
  private ok() { return !!this.ctx && !this.muted; }

  click() { if (!this.ok()) return; const t = this.now; if (this.sample('click', t, 0.97 + Math.random() * 0.06, 0.5)) return; this.pluck(84, t, 0.05, 0.08, false, 'square'); }

  spinStart() {
    if (!this.ok()) return;
    if (!this.sample('spin', this.now, 0.97 + Math.random() * 0.06, 0.9)) this.sweep(this.now, 0.35, 400, 2400, 0.25, 1.5);
  }

  reelStop(i: number) {
    if (!this.ok()) return;
    const t = this.now;
    // Small pitch drift per reel and per spin so five stops in a row don't sound copy-pasted.
    if (this.sample('reel', t, 0.96 + i * 0.015 + Math.random() * 0.03, 0.9)) return;
    this.kick(t, 0.25, false);
    this.pluck(60 + i, t, 0.06, 0.05, false, 'square');
  }

  /**
   * Note for the nth bonus landing: walks up the F major scale (diatonic to the D minor music),
   * up to three octaves from F4, then holds the top F so it never drops back down.
   */
  static walkNote(step: number, root = 65): number {
    const SCALE = [0, 2, 4, 5, 7, 9, 11];
    const i = Math.min(step, 21);
    return root + 12 * Math.floor(i / 7) + SCALE[i % 7];
  }

  /** n = how many scatters have landed so far this spin (1, 2, 3...): an F-A-C-F arpeggio up the octave. */
  scatter(n: number) {
    if (!this.ok()) return;
    const t = this.now;
    const root = [77, 81, 84, 89][Math.min(n - 1, 3)];
    // Each extra Moon Gate rings higher: root, major third, fifth, octave.
    if (this.sample('gate', t, 2 ** ((root - 77) / 12), n >= 3 ? 1.1 : 0.9)) return;
    this.bell(root, t, 0.2, false);
    this.bell(root + 12, t + 0.05, 0.1, false);
    this.pluck(root, t, 0.4, 0.06, false, 'sine');
    if (n >= 3) { this.bell(root + 7, t + 0.1, 0.12, false); this.bell(root + 19, t + 0.16, 0.08, false); }
  }

  /**
   * An orb landing. step = how many orbs have landed before it in this sequence; each one is a scale step higher.
   * delay (seconds) lets several orbs in one reel ring out one after another.
   */
  orbLand(step = 0, delay = 0) {
    if (!this.ok()) return;
    const t = this.now + delay;
    const note = AudioEngine.walkNote(step);
    const lift = Math.min(step, 21) / 21; // 0..1 as the walk climbs
    // The recorded slam rises about a fifth over the walk; the bells below carry the full octave climb.
    if (!this.sample('orb', t, 2 ** ((7 * lift) / 12), 0.85 + 0.2 * lift)) this.kick(t, 0.32 + 0.15 * lift, false);
    this.bell(note, t, 0.14 + 0.06 * lift, false);
    this.pluck(note, t, 0.35, 0.07, false, 'triangle');
    if (step < 14) this.bell(note + 12, t + 0.02, 0.05 + 0.05 * lift, false); // octave sparkle, dropped up top so it doesn't get shrill
    if (step >= 7 && step < 14) this.bell(note + 7, t + 0.04, 0.05, false); // add a fifth once the second octave starts
    if (step >= 21) this.coinShower(0.4); // at the top, every new orb adds a shimmer
  }

  /** Rising tension while the last reel spins. */
  anticipation(seconds: number) {
    if (!this.ok()) return;
    const t = this.now;
    const buf = this.buffers.get(AudioEngine.SAMPLES.antic);
    if (buf) {
      const len = buf.duration;
      if (this.sample('antic', t + Math.max(0, seconds - len), 1, 0.9, Math.max(0, len - seconds))) return;
    }
    this.sweep(t, seconds, 200, 4000, 0.25, 6);
    const g = this.env(t, 0.06, seconds * 0.9, 0.2, false, 0.3);
    const o = this.osc('sawtooth', hz(50), t, seconds, g);
    o.frequency.exponentialRampToValueAtTime(hz(74), t + seconds);
  }

  private lastCell = 0;
  /** Soft click as an empty hold & spin cell stops (rate-limited; many cells stop together). */
  cellStop() {
    if (!this.ok()) return;
    const t = this.now;
    if (t - this.lastCell < 0.035) return;
    this.lastCell = t;
    if (this.sample('cell', t, 0.9 + Math.random() * 0.2, 0.5)) return;
    this.pluck(55 + Math.floor(Math.random() * 3), t, 0.05, 0.05, false, 'square');
    this.kick(t, 0.08, false);
  }

  /** Stone doors grinding before they open. */
  doorRumble() {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('rumble', t, 1, 0.9)) return;
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    lp.connect(this.env(t, 0.35, 0.2, 0.5, false, 0.3));
    this.noiseSrc(t, 0.75, lp);
    this.taiko(t, 0.3, false);
  }

  /** Doors swing open: a whoosh and a bright chord. */
  doorOpen() {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('doorOpen', t, 1, 0.9)) return;
    this.sweep(t, 0.5, 300, 3500, 0.25, 2);
    this.brass([62, 69, 74, 78], t + 0.05, 0.6, 0.09, false);
    this.bell(86, t + 0.1, 0.12, false);
  }

  /** A wild locking in place. */
  sticky() {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('sticky', t, 1, 0.85)) return;
    this.pluck(79, t, 0.15, 0.08, false, 'square');
    this.bell(91, t + 0.04, 0.1, false);
    this.kick(t, 0.2, false);
  }

  chime() {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('chime', t, 1, 0.8)) return;
    [84, 88, 91, 96].forEach((m, i) => this.bell(m, t + i * 0.07, 0.09, false));
  }

  respinReset() { if (!this.ok()) return; const t = this.now; if (this.sample('reset', t, 1, 0.75)) return; this.sweep(t, 0.25, 800, 3000, 0.15, 3); this.pluck(79, t + 0.05, 0.1, 0.06, false, 'square'); }

  rowUnlock() {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('row', t, 1, 0.9)) return;
    this.taiko(t, 0.8, false);
    this.sweep(t, 0.4, 3000, 300, 0.35, 1);
    this.brass([62, 69, 74], t + 0.05, 0.5, 0.08, false);
  }

  special() {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('special', t, 1, 0.9)) return;
    [84, 88, 91, 96].forEach((n, i) => this.pluck(n, t + i * 0.05, 0.25, 0.06, false));
  }

  lineWin(big: boolean) {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample('win', t, big ? 1.122 : 1, big ? 1.15 : 0.85)) {
      if (big) this.sample('win', t + 0.14, 1.498, 0.6); // bigger wins add a higher echo
      return;
    }
    const notes = big ? [72, 76, 79, 84, 88] : [72, 76, 79];
    notes.forEach((n, i) => this.pluck(n, t + i * 0.06, 0.3, 0.08, false));
  }

  /** Rate-limited coin counter tick. */
  tick() {
    if (!this.ok()) return;
    const t = this.now;
    if (t - this.lastTick < 0.045) return;
    this.lastTick = t;
    if (this.sample('tick', t, 0.96 + Math.random() * 0.1, 0.35)) return;
    this.pluck(96 + Math.floor(Math.random() * 3), t, 0.04, 0.03, false, 'square');
  }

  coinShower(seconds = 1.5) {
    if (!this.ok()) return;
    const t = this.now;
    const buf = this.buffers.get(AudioEngine.SAMPLES.coins);
    if (buf) {
      // The recording loops for as long as the celebration lasts, then fades out.
      const c = this.ctx!;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.7, t + 0.08);
      g.gain.setValueAtTime(0.7, t + Math.max(0.1, seconds - 0.4));
      g.gain.linearRampToValueAtTime(0, t + seconds + 0.2);
      src.connect(g).connect(this.sfxBus);
      src.start(t, Math.random() * buf.duration);
      src.stop(t + seconds + 0.3);
      return;
    }
    for (let i = 0; i < seconds * 22; i++) this.bell(96 + Math.floor(Math.random() * 8), t + Math.random() * seconds, 0.03, false);
  }

  fanfare(kind: 'feature' | 'small' | 'big' | 'jackpot' = 'feature') {
    if (!this.ok()) return;
    const t = this.now;
    if (this.sample(kind, t, 1, kind === 'small' ? 0.8 : 1)) {
      // Dip the music under the bigger fanfares so they land, then bring it back.
      const len = this.buffers.get(AudioEngine.SAMPLES[kind])!.duration;
      if (kind !== 'small') {
        const g = this.musicBus.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(g.value, t);
        g.linearRampToValueAtTime(0.18, t + 0.15);
        g.setValueAtTime(0.18, t + len - 1.5);
        g.linearRampToValueAtTime(0.55, t + len);
      }
      if (kind === 'big' || kind === 'jackpot') this.coinShower(kind === 'jackpot' ? 4 : 2.5);
      return;
    }
    if (kind === 'small') {
      this.brass([65, 69, 72], t, 0.25, 0.1, false);
      this.brass([67, 71, 74], t + 0.25, 0.25, 0.1, false);
      this.brass([72, 76, 79, 84], t + 0.5, 0.9, 0.12, false);
      return;
    }
    const seq: [number[], number, number][] = [
      [[60, 64, 67], 0, 0.22],
      [[60, 64, 67], 0.25, 0.12],
      [[65, 69, 72], 0.4, 0.35],
      [[67, 71, 74], 0.8, 0.35],
      [[72, 76, 79, 84], 1.2, 1.6],
    ];
    for (const [n, at, d] of seq) this.brass(n, t + at, d, 0.11, false);
    this.taiko(t, 0.6, false);
    this.taiko(t + 0.8, 0.5, false);
    this.taiko(t + 1.2, 0.8, false);
    this.snare(t + 1.2, 0.2, false);
    this.bell(96, t + 1.2, 0.12, false);
    if (kind !== 'feature') this.coinShower(kind === 'jackpot' ? 2.5 : 2);
  }

  roar() {
    if (!this.ok()) return;
    const c = this.ctx!, t = this.now;
    if (this.sample('roar', t + 0.15, 1, 0.95)) return; // just after the thunder crack
    const shaper = c.createWaveShaper();
    const curve = new Float32Array(256);
    for (let i = 0; i < 256; i++) { const x = (i / 128) - 1; curve[i] = Math.tanh(x * 6); }
    shaper.curve = curve;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(300, t + 1.6);
    shaper.connect(lp).connect(this.env(t, 0.35, 0.08, 1.6, false, 0.6));
    for (const d of [-20, 0, 25]) {
      const o = this.osc('sawtooth', 110, t, 1.7, shaper, d);
      o.frequency.exponentialRampToValueAtTime(48, t + 1.6);
    }
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.connect(this.env(t, 0.3, 0.05, 1.4, false, 0.5));
    this.noiseSrc(t, 1.5, bp);
    this.taiko(t, 0.9, false);
  }

  thunder() {
    if (!this.ok()) return;
    const c = this.ctx!, t = this.now;
    if (this.sample('thunder', t, 0.94 + Math.random() * 0.12, 0.9)) return;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3000, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.5);
    lp.connect(this.env(t, 0.5, 0.005, 1.8, false, 0.6));
    this.noiseSrc(t, 1.9, lp);
  }
}

export const audio = new AudioEngine();

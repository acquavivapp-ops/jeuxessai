// Original Web Audio score for BLUE NIGHT: Calvi after hours, 114 BPM.
// Synthesized locally; no recording, download, or audio before a user gesture.
const TEMPO = 114;
const MELODIES = [
  [null, null, 69, null, null, null, 72, null, null, 74, null, null, 76, null, null, null],
  [null, 69, null, null, null, null, 65, null, null, null, 62, null, null, null, 64, null],
  [null, null, 67, null, null, null, null, 69, null, null, 70, null, null, null, 69, null],
  [null, null, 64, null, null, 67, null, null, null, null, 73, null, null, null, 69, null],
  [null, 69, null, null, 72, null, null, null, null, null, 76, null, null, 74, null, null],
  [null, null, 69, null, null, null, null, 65, null, null, 62, null, null, 64, null, null],
  [null, null, 67, null, null, null, 70, null, null, 74, null, null, 69, null, null, null],
  [null, null, 64, null, null, null, 67, null, null, null, 73, null, null, 69, null, null],
];
const ROOTS = [50, 46, 43, 45, 50, 46, 43, 45];
const CHORDS = [
  [50, 53, 57, 60, 64], // D minor 9
  [46, 50, 53, 57, 60], // B-flat major 9
  [43, 46, 50, 53, 57], // G minor 9
  [45, 52, 55, 61, 65], // A dominant, resolving to D minor
];
const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17];
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);
const clamp = (n, low, high) => Math.min(high, Math.max(low, n));
// Six short original synth patches match the six arcade firing patterns.
const SHOT_PATCHES = [
  { duration: .06, gain: .065, frequency: 2400, end: 350, note: 68, tail: .07, slide: 43 },
  { duration: .035, gain: .05, frequency: 3300, end: 700, note: 73, tail: .045, slide: 51 },
  { duration: .16, gain: .14, frequency: 1100, end: 350, note: 43, tail: .18, slide: 27 },
  { duration: .13, gain: .11, frequency: 1900, end: 190, note: 49, tail: .14, slide: 32 },
  { duration: .09, gain: .085, frequency: 4600, end: 850, note: 77, tail: .1, slide: 45 },
  { duration: .05, gain: .06, frequency: 2900, end: 530, note: 70, tail: .065, slide: 46 },
];

export class AudioEngine {
  constructor({ muted = false } = {}) {
    this.muted = Boolean(muted);
    this.playing = false;
    this.intensity = 0;
    this.combo = 0;
    this.context = null;
    this.unlocked = false;
    this._disposed = false;
    this._timer = null;
    this._voices = new Set();
    this._step = 0;
    this._nextStep = 0;
    this._unlocking = null;
    this._lastDetonate = -10;
    this._lastRadio = -10;
    this._district = "port";
    this._vehicleSpeed = null;
    this._vehicleVoice = null;
    this._onVisibility = () => this._visibilityChanged();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this._onVisibility);
    }
  }

  // Call from a pointer/key event. Returns false when audio is unavailable.
  async unlock() {
    if (this._disposed) return false;
    if (this._unlocking) return this._unlocking;
    this._unlocking = this._doUnlock();
    try {
      return await this._unlocking;
    } finally {
      this._unlocking = null;
    }
  }

  async _doUnlock() {
    try {
      if (!this.context) {
        const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AudioContextClass) return false;
        this.context = new AudioContextClass({ latencyHint: "interactive" });
        this._master = this.context.createGain();
        this._music = this.context.createGain();
        this._effects = this.context.createGain();
        this._master.gain.value = this.muted ? 0 : 0.55;
        this._music.gain.value = 0.52;
        this._effects.gain.value = 0.78;
        this._music.connect(this._master);
        this._effects.connect(this._master);
        this._limiter = this.context.createDynamicsCompressor();
        this._limiter.threshold.value = -12;
        this._limiter.knee.value = 10;
        this._limiter.ratio.value = 8;
        this._limiter.attack.value = 0.003;
        this._limiter.release.value = 0.18;
        this._master.connect(this._limiter);
        this._limiter.connect(this.context.destination);
        this._noiseBuffer = this._createNoise();
        this._roomBuffer = this._createRoom();
        this._room = this.context.createConvolver();
        this._room.buffer = this._roomBuffer;
        this._roomSend = this.context.createGain();
        this._roomWet = this.context.createGain();
        this._roomSend.gain.value = 0.18;
        this._roomWet.gain.value = 0;
        this._music.connect(this._roomSend);
        this._roomSend.connect(this._room);
        this._room.connect(this._roomWet);
        this._roomWet.connect(this._master);
      }
      // resume() is deliberately called inside the original user gesture.
      if (this.context.state !== "running") await this.context.resume();
      if (this._disposed) return false;
      this.unlocked = this.context.state === "running";
      if (this.unlocked) this._startScheduler();
      return this.unlocked;
    } catch {
      // A disabled audio device or browser policy must never break the game.
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this._master && this.context.state !== "closed") {
      const now = this.context.currentTime;
      this._master.gain.cancelScheduledValues(now);
      this._master.gain.setTargetAtTime(this.muted ? 0 : 0.55, now, 0.015);
    }
    if (this.muted) {
      this._stopScheduler();
      this._stopVoices();
      this._silenceRoom();
    } else {
      this._startScheduler();
    }
  }

  setPlaying(playing) {
    const next = Boolean(playing);
    if (next === this.playing) return;
    this.playing = next;
    if (next) {
      this._step = 0;
      this._startScheduler();
    } else {
      this._stopScheduler();
      this._stopVoices();
      this._silenceRoom();
    }
  }

  setIntensity(level) {
    this.intensity = clamp(Number(level) || 0, 0, 1);
  }

  setCombo(count) {
    this.combo = clamp(Math.floor(Number(count) || 0), 0, 99);
  }

  // Choosing an ambience is safe before unlock and never creates audio nodes.
  setDistrict(id) {
    const name = String(id || "").toLowerCase();
    this._district = /port|quai|harbou?r/.test(name) ? "port"
      : /citadel|village|vielle|vieille/.test(name) ? "citadelle"
        : /market|march[eé]/.test(name) ? "market" : "street";
  }

  // A null speed means the player is on foot. Call freely, including before
  // unlock: driving never creates an AudioContext or bypasses a user gesture.
  setVehicle(speed) {
    this._vehicleSpeed = typeof speed === "number" && Number.isFinite(speed)
      ? clamp(Math.abs(speed), 0, 210) : null;
    this._syncVehicle();
  }

  play(name, variant = 0) {
    if (!this._canSound()) return;
    const t = this.context.currentTime + 0.005;
    const choice = Math.abs(Math.floor(Number(variant) || 0));
    switch (name) {
      case "shoot": {
        const patch = SHOT_PATCHES[choice % SHOT_PATCHES.length];
        this._noise(t, patch.duration, { gain: patch.gain, filter: "lowpass", frequency: patch.frequency, frequencyEnd: patch.end, attack: .001 });
        this._tone(patch.note, t, patch.tail, { gain: .07, type: "triangle", slideTo: patch.slide, fm: choice === 4 ? 3 : 2 });
        if (choice === 3) this._noise(t + .18, .045, { gain: .023, filter: "bandpass", frequency: 1300, frequencyEnd: 700, attack: .002 });
        break;
      }
      case "vehicleExplosion":
        this.play("explosion", 4);
        break;
      case "vehicleFire":
        this._noise(t, 0.38, { gain: 0.045, filter: "bandpass", frequency: 1400, frequencyEnd: 750, attack: 0.025 });
        break;
      case "buildingDestroyed":
        this._noise(t, 0.28, { gain: 0.14, filter: "lowpass", frequency: 1200, frequencyEnd: 150, attack: 0.002 });
        break;
      case "weapon":
        this._tone(74, t, 0.06, { gain: 0.07, type: "sine", slideTo: 81 });
        break;
      case "radio":
        if (!this.playing || t - this._lastRadio < 0.8) return;
        this._lastRadio = t;
        this._noise(t, 0.16, { gain: 0.028, filter: "bandpass", frequency: 1500, frequencyEnd: 650, attack: 0.012 });
        this._jingle([62, 69, 64], t + 0.045, 0.105, 0.18, 0.065, "sine");
        break;
      case "start":
        [50, 57, 60, 64].forEach((note, i) => this._tone(note, t + i * 0.018, 0.38, { gain: 0.055, type: "sine", fm: 0.8, fmRatio: 1, cutoff: 1700, attack: 0.012, sustain: 0.35 }));
        this._tone(69, t + 0.24, 0.23, { gain: 0.042, type: "sine", fm: 0.7, fmRatio: 1 });
        break;
      case "plant":
        this._tone(50, t, 0.065, { gain: 0.14, type: "sine", slideTo: 62, fm: 1.1 });
        this._tone(74, t + 0.05, 0.08, { gain: 0.08, type: "sine", fm: 1.5 });
        break;
      case "detonate":
        if (t - this._lastDetonate < 0.075) return;
        this._lastDetonate = t;
        this._jingle([62, 74, 86], t, 0.028, 0.085, 0.12);
        this._tone(50, t + 0.055, 0.16, { gain: 0.19, type: "triangle", slideTo: 31 });
        break;
      case "explosion": {
        const impact = 0.19 + Math.min(choice, 8) * 0.009;
        this._noise(t, 0.22, { gain: impact, filter: "lowpass", frequency: 2100, frequencyEnd: 200, attack: 0.001 });
        this._tone(49, t, 0.24, { gain: impact * 0.8, type: "triangle", slideTo: 24, fm: 2.5, attack: 0.001 });
        this._noise(t + 0.04, 0.36, { gain: impact * 0.22, filter: "bandpass", frequency: 1200, frequencyEnd: 410, attack: 0.012, pan: 0.18 });
        this._tone(33, t + 0.06, 0.52, { gain: impact * 0.38, type: "sine", slideTo: 24, attack: 0.012, sustain: 0.2 });
        break;
      }
      case "demolish":
        this._noise(t, 0.28, { gain: 0.17, filter: "lowpass", frequency: 1500, frequencyEnd: 170, attack: 0.004 });
        this._jingle([81, 77, 74, 69, 65, 62], t, 0.045, 0.11, 0.085, "triangle");
        this._tone(38, t + 0.1, 0.29, { gain: 0.18, type: "sine", slideTo: 26 });
        break;
      case "pickup": {
        const note = 77 + PENTATONIC[choice % PENTATONIC.length];
        this._tone(note, t, 0.15, { gain: 0.17, type: "sine", fm: 1.8, pan: (choice % 3 - 1) * 0.3 });
        this._tone(note + 12, t + 0.025, 0.09, { gain: 0.045, type: "sine", fm: 0.5 });
        break;
      }
      case "combo": {
        const lift = Math.min(7, Math.floor(choice / 3));
        this._jingle([74 + lift, 77 + lift, 81 + lift, 86 + lift], t, 0.043, 0.12, 0.14);
        break;
      }
      case "hurt":
        this._tone(61, t, 0.13, { gain: 0.15, type: "square", cutoff: 1500, slideTo: 45, fm: 1.2 });
        this._tone(58, t + 0.08, 0.16, { gain: 0.11, type: "triangle", slideTo: 41 });
        break;
      case "car":
        this._noise(t, 0.055, { gain: 0.055, filter: "lowpass", frequency: 950 });
        this._tone(39, t + 0.025, 0.24, { gain: 0.12, type: "triangle", slideTo: 48, sustain: 0.45 });
        break;
      case "hit":
        this._noise(t, 0.12, { gain: 0.085, filter: "lowpass", frequency: 850, frequencyEnd: 180, attack: 0.002 });
        this._tone(35, t, 0.12, { gain: 0.1, type: "triangle", slideTo: 27, attack: 0.002 });
        break;
      case "heat":
        // A short two-note beacon announces pursuit without a looping siren.
        this._tone(73, t, 0.2, { gain: 0.1, type: "sine", slideTo: 82, sustain: 0.7 });
        this._tone(82, t + 0.18, 0.2, { gain: 0.09, type: "sine", slideTo: 73, sustain: 0.6 });
        break;
      case "stage":
        this._jingle([74, 77, 81, 86, 81, 86], t, 0.065, 0.17, 0.12);
        this._tone(50, t, 0.32, { gain: 0.12, type: "triangle", sustain: 0.5 });
        break;
      case "win":
        this._jingle([74, 78, 81, 86, 83, 86], t, 0.105, 0.24, 0.19);
        this._tone(50, t, 0.6, { gain: 0.15, type: "triangle", sustain: 0.65 });
        this._tone(69, t + 0.53, 0.5, { gain: 0.075, type: "sine", fm: 1.2 });
        break;
      case "lose":
        this._jingle([77, 74, 70], t, 0.13, 0.22, 0.14, "triangle");
        this._tone(62, t + 0.4, 0.46, { gain: 0.18, type: "triangle", slideTo: 49, sustain: 0.55 });
        break;
      case "click":
        this._tone(83, t, 0.055, { gain: 0.07, type: "sine", slideTo: 76, fm: 0.5 });
        break;
      default:
        break;
    }
  }

  _canSound() {
    return !this._disposed && this.unlocked && !this.muted
      && this.context?.state === "running"
      && !(typeof document !== "undefined" && document.hidden);
  }

  _startScheduler() {
    this._syncVehicle();
    if (this._timer !== null || !this.playing || !this._canSound()) return;
    if (this._room && this._room.buffer !== this._roomBuffer) this._room.buffer = this._roomBuffer;
    if (this._roomWet) this._roomWet.gain.setTargetAtTime(0.24, this.context.currentTime, 0.02);
    this._nextStep = this.context.currentTime + 0.055;
    const schedule = () => {
      this._timer = null;
      if (!this.playing || !this._canSound()) return;
      const now = this.context.currentTime;
      // Skip a delayed tab's missed notes instead of emitting them all at once.
      if (this._nextStep < now - 0.12) this._nextStep = now + 0.035;
      while (this._nextStep < now + 0.13) {
        const step = this._step++;
        this._musicStep(step, this._nextStep + (step % 2 ? 0.014 : 0));
        this._nextStep += 60 / TEMPO / 4;
      }
      this._timer = globalThis.setTimeout(schedule, 25);
    };
    schedule();
  }

  _stopScheduler() {
    if (this._timer !== null) globalThis.clearTimeout(this._timer);
    this._timer = null;
  }

  _syncVehicle() {
    if (this._vehicleSpeed === null || !this.playing || !this._canSound()) {
      if (this._vehicleVoice) this._stopVoices("vehicle");
      return;
    }
    const ctx = this.context;
    const now = ctx.currentTime;
    const speed = this._vehicleSpeed / 210;
    if (!this._vehicleVoice) {
      if (this._voices.size >= 128) return;
      const rumble = ctx.createOscillator();
      const buzz = ctx.createOscillator();
      const buzzLevel = ctx.createGain();
      const flutter = ctx.createOscillator();
      const flutterDepth = ctx.createGain();
      const road = ctx.createBufferSource();
      const roadFilter = ctx.createBiquadFilter();
      const roadLevel = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const envelope = ctx.createGain();
      rumble.type = "triangle";
      buzz.type = "sawtooth";
      flutter.type = "sine";
      rumble.frequency.value = 27 + speed * 53;
      buzz.frequency.value = (27 + speed * 53) * 2.01;
      flutter.frequency.value = 6 + speed * 7;
      buzzLevel.gain.value = 0.13;
      flutterDepth.gain.value = 0.003;
      road.buffer = this._noiseBuffer;
      road.loop = true;
      roadFilter.type = "bandpass";
      roadFilter.Q.value = 0.45;
      roadFilter.frequency.value = 700;
      roadLevel.gain.value = 0;
      filter.type = "lowpass";
      filter.Q.value = 0.6;
      envelope.gain.value = 0;
      rumble.connect(filter);
      buzz.connect(buzzLevel);
      buzzLevel.connect(filter);
      filter.connect(envelope);
      flutter.connect(flutterDepth);
      flutterDepth.connect(envelope.gain);
      envelope.connect(this._effects);
      road.connect(roadFilter); roadFilter.connect(roadLevel); roadLevel.connect(this._effects);
      const sources = [rumble, buzz, flutter, road];
      const nodes = [...sources, buzzLevel, flutterDepth, filter, envelope, roadFilter, roadLevel];
      const voice = this._trackVoice("vehicle", rumble, sources, nodes);
      Object.assign(voice, { rumble, buzz, flutter, filter, envelope, roadFilter, roadLevel });
      this._vehicleVoice = voice;
      for (const source of sources) source.start(now);
    }
    const voice = this._vehicleVoice;
    const frequency = 27 + speed * 53;
    // Smooth the roughly 10 Hz input so acceleration never clicks.
    voice.rumble.frequency.setTargetAtTime(frequency, now, 0.045);
    voice.buzz.frequency.setTargetAtTime(frequency * 2.01, now, 0.045);
    voice.flutter.frequency.setTargetAtTime(6 + speed * 7, now, 0.06);
    voice.filter.frequency.setTargetAtTime(310 + speed * 690, now, 0.06);
    voice.envelope.gain.setTargetAtTime(0.023 + speed * 0.051, now, 0.025);
    voice.roadFilter.frequency.setTargetAtTime(700 + speed * 1500, now, 0.07);
    voice.roadLevel.gain.setTargetAtTime(speed ** 1.4 * 0.024, now, 0.07);
  }

  _musicStep(index, t) {
    const step = index % 16;
    const bar = Math.floor(index / 16) % 8;
    const root = ROOTS[bar];
    const note = MELODIES[bar][step];
    if (note !== null) {
      this._tone(note, t, 0.28, {
        kind: "music", gain: 0.059, type: "sine", fm: 0.9, fmRatio: 1,
        cutoff: 2100, cutoffEnd: 900, attack: 0.007,
        sustain: 0.32, pan: bar % 2 ? 0.2 : -0.2,
      });
      if (this.combo >= 5 && step === 0) {
        this._tone(note + 12, t, 0.21, { kind: "music", gain: 0.025, type: "sine", fm: 1.5, pan: 0.4 });
      }
    }
    if (step === 2 || step === 10) {
      for (const [i, chordNote] of CHORDS[bar % 4].entries()) {
        this._tone(chordNote, t + i * 0.006, step === 2 ? 0.75 : 0.52, {
          kind: "music", gain: 0.027, type: "sine", fm: 1.2, fmRatio: 1,
          detune: i % 2 ? 4 : -4, cutoff: 1600 + this.intensity * 700,
          cutoffEnd: 650, attack: 0.012, sustain: 0.27, pan: (i - 2) * 0.16,
        });
      }
    }
    if ([0, 3, 6, 8, 11, 14].includes(step)) {
      const bassNote = root - 12 + (step === 6 || step === 14 ? 7 : step === 11 ? 12 : 0);
      this._tone(bassNote, t, 0.17, { kind: "music", gain: 0.17, type: "triangle", cutoff: 1000, cutoffEnd: 280, attack: 0.006, sustain: 0.45 });
      if (step === 0 || step === 8) this._tone(bassNote - 12, t, 0.24, { kind: "music", gain: 0.035, type: "sine", attack: 0.012, sustain: 0.4 });
    }
    if (step % 4 === 0) {
      this._tone(38, t, 0.11, { kind: "music", gain: 0.18, type: "sine", slideTo: 25, attack: 0.001, sustain: 0.2 });
    }
    if (step === 4 || step === 12) {
      this._noise(t, 0.12, { kind: "music", gain: 0.055, filter: "bandpass", frequency: 1700, attack: 0.001 });
      this._noise(t + 0.008, 0.055, { kind: "music", gain: 0.025, filter: "highpass", frequency: 1900, attack: 0.001 });
      this._tone(48, t, 0.06, { kind: "music", gain: 0.025, type: "triangle", slideTo: 40, attack: 0.001 });
    }
    if (step % 2 === 0) {
      this._noise(t, step % 4 === 2 ? 0.068 : 0.025, { kind: "music", gain: step % 4 ? 0.028 : 0.018, filter: "highpass", frequency: 5700, attack: 0.001, pan: -0.16 });
    }
    if (step === 7 || step === 15) {
      this._tone(root + 24, t, 0.042, { kind: "music", gain: 0.022, type: "sine", fm: 2.7, fmRatio: 1.45, cutoff: 2400, attack: 0.001, pan: 0.28 });
    }
    if (this.combo >= 3 && (step === 7 || step === 15)) {
      this._tone(root + 24 + PENTATONIC[this.combo % 5], t, 0.12, {
        kind: "music", gain: 0.045, type: "sine", fm: 2.5, pan: step === 7 ? -0.5 : 0.5,
      });
    }
    // A quiet offbeat ticking layer makes the last seconds feel faster.
    if (this.intensity > 0.55 && step % 2 === 1) {
      this._tone(root + 36 + (step % 4 === 1 ? 7 : 0), t, 0.037, {
        kind: "music", gain: 0.025 + (this.intensity - 0.55) * 0.045,
        type: "sine", fm: 2, attack: 0.001, pan: step % 4 === 1 ? -0.3 : 0.3,
      });
    }
    if (index % 64 === 0) this._ambienceStep(index, t);
  }

  _ambienceStep(index, t) {
    if (this._district === "port") {
      // Filtered local noise evokes a sheltered quay; it is not a recording.
      this._noise(t, 1.8, { kind: "ambience", gain: 0.017, filter: "lowpass", frequency: 520, frequencyEnd: 280, attack: 0.32, pan: -0.25 });
      if (index % 128 === 64) this._tone(81, t + 0.65, 0.32, { kind: "ambience", gain: 0.007, type: "sine", slideTo: 77, attack: 0.06, pan: 0.4 });
    } else if (this._district === "citadelle") {
      this._noise(t, 1.2, { kind: "ambience", gain: 0.01, filter: "bandpass", frequency: 390, frequencyEnd: 520, attack: 0.28, pan: 0.3 });
    } else if (this._district === "market") {
      this._noise(t + 0.18, 0.09, { kind: "ambience", gain: 0.012, filter: "bandpass", frequency: 1100, attack: 0.008, pan: 0.3 });
      this._tone(63, t + 0.24, 0.08, { kind: "ambience", gain: 0.009, type: "sine", fm: 1.4, pan: -0.2 });
    } else {
      this._noise(t, 0.75, { kind: "ambience", gain: 0.008, filter: "lowpass", frequency: 480, attack: 0.22 });
    }
  }

  _jingle(notes, t, spacing, duration, gain, type = "sine") {
    notes.forEach((note, i) => {
      this._tone(note, t + i * spacing, duration, { gain, type, fm: type === "sine" ? 1.7 : 0, sustain: 0.35 });
    });
  }

  _envelope(param, t, duration, gain, attack = 0.004, sustain = 0.15) {
    const rise = Math.min(attack, duration * 0.3);
    const release = Math.min(0.04, duration * 0.35);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(gain, t + rise);
    param.exponentialRampToValueAtTime(Math.max(0.0001, gain * sustain), t + Math.max(rise, duration - release));
    param.exponentialRampToValueAtTime(0.0001, t + duration);
  }

  _tone(note, t, duration, options = {}) {
    if (this._voices.size >= 128) return;
    const ctx = this.context;
    const { kind = "effect", gain = 0.1, type = "square", fm = 0, fmRatio = 2, detune = 0, cutoff = 6000, cutoffEnd,
      attack = 0.004, sustain = 0.15, pan = 0, slideTo } = options;
    const osc = ctx.createOscillator();
    const envelope = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    const nodes = [osc, envelope, filter];
    const sources = [osc];
    osc.type = type;
    osc.detune.value = detune;
    osc.frequency.setValueAtTime(hz(note), t);
    if (slideTo !== undefined) osc.frequency.exponentialRampToValueAtTime(hz(slideTo), t + duration * 0.85);
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(cutoff, t);
    if (cutoffEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(cutoffEnd, t + duration);
    filter.Q.value = 0.5;
    this._envelope(envelope.gain, t, duration, gain, attack, sustain);
    osc.connect(filter);
    filter.connect(envelope);
    this._connectOutput(envelope, nodes, kind, pan);
    if (fm) {
      const mod = ctx.createOscillator();
      const depth = ctx.createGain();
      mod.type = "sine";
      mod.frequency.setValueAtTime(hz(note) * fmRatio, t);
      depth.gain.setValueAtTime(hz(note) * fm, t);
      depth.gain.exponentialRampToValueAtTime(0.001, t + duration);
      mod.connect(depth);
      depth.connect(osc.frequency);
      nodes.push(mod, depth);
      sources.push(mod);
    }
    this._trackVoice(kind, osc, sources, nodes);
    for (const source of sources) {
      source.start(t);
      source.stop(t + duration + 0.01);
    }
  }

  _noise(t, duration, options = {}) {
    if (this._voices.size >= 128) return;
    const ctx = this.context;
    const { kind = "effect", gain = 0.1, filter: filterType = "bandpass", frequency = 2500, frequencyEnd, attack = 0.002, pan = 0 } = options;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const envelope = ctx.createGain();
    source.buffer = this._noiseBuffer;
    source.loop = duration > this._noiseBuffer.duration;
    filter.type = filterType;
    filter.frequency.setValueAtTime(frequency, t);
    if (frequencyEnd !== undefined) filter.frequency.exponentialRampToValueAtTime(frequencyEnd, t + duration);
    filter.Q.value = 0.7;
    this._envelope(envelope.gain, t, duration, gain, attack, 0.1);
    source.connect(filter);
    filter.connect(envelope);
    const nodes = [source, filter, envelope];
    this._connectOutput(envelope, nodes, kind, pan);
    this._trackVoice(kind, source, [source], nodes);
    source.start(t, Math.random() * 0.12);
    source.stop(t + duration + 0.01);
  }

  _connectOutput(envelope, nodes, kind, pan) {
    const bus = kind === "music" ? this._music : this._effects;
    if (pan && this.context.createStereoPanner) {
      const panner = this.context.createStereoPanner();
      panner.pan.value = pan;
      envelope.connect(panner);
      panner.connect(bus);
      nodes.push(panner);
    } else {
      envelope.connect(bus);
    }
  }

  _trackVoice(kind, principal, sources, nodes) {
    const voice = { kind, sources, nodes };
    this._voices.add(voice);
    principal.onended = () => {
      this._voices.delete(voice);
      if (this._vehicleVoice === voice) this._vehicleVoice = null;
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* Already disconnected. */ }
      }
      principal.onended = null;
    };
    return voice;
  }

  _stopVoices(kind) {
    for (const voice of this._voices) {
      if (kind && voice.kind !== kind) continue;
      for (const source of voice.sources) {
        try { source.stop(); } catch { /* An ended source needs no cleanup. */ }
      }
      for (const node of voice.nodes) {
        try { node.disconnect(); } catch { /* Already disconnected. */ }
      }
      this._voices.delete(voice);
    }
    if (!kind || kind === "vehicle") this._vehicleVoice = null;
  }

  _createNoise() {
    const length = Math.ceil(this.context.sampleRate * 0.65);
    const buffer = this.context.createBuffer(1, length, this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  _createRoom() {
    const length = Math.ceil(this.context.sampleRate * 0.52);
    const buffer = this.context.createBuffer(2, length, this.context.sampleRate);
    const preDelay = Math.floor(this.context.sampleRate * 0.018);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = preDelay; i < length; i++) {
        const envelope = Math.exp(-8 * (i - preDelay) / (length - preDelay));
        data[i] = (Math.random() * 2 - 1) * envelope;
      }
    }
    return buffer;
  }

  _silenceRoom() {
    if (!this._roomWet || !this.context || this.context.state === "closed") return;
    const now = this.context.currentTime;
    this._roomWet.gain.cancelScheduledValues(now);
    this._roomWet.gain.setValueAtTime(0, now);
    // Clear the convolution history as well as its output. A resumed game
    // must not replay the tail of a chord from before pause or mute.
    this._room.buffer = null;
  }

  _visibilityChanged() {
    if (this._disposed || !this.context) return;
    if (document.hidden) {
      this._stopScheduler();
      this._stopVoices();
      this._silenceRoom();
      if (this.context.state === "running") this.context.suspend().catch(() => {});
    } else if (this.unlocked && this.context.state === "suspended") {
      this.context.resume().then(() => this._startScheduler()).catch(() => {});
    } else {
      this._startScheduler();
    }
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.playing = false;
    this._stopScheduler();
    this._stopVoices();
    this._silenceRoom();
    for (const node of [this._room, this._roomSend, this._roomWet]) {
      try { node?.disconnect(); } catch { /* Already disconnected. */ }
    }
    if (typeof document !== "undefined") {
      document.removeEventListener("visibilitychange", this._onVisibility);
    }
    if (this.context && this.context.state !== "closed") {
      this.context.close().catch(() => {});
    }
  }
}

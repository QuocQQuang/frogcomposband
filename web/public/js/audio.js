// Procedural Web Audio API synthesizer for FrogComposband SOUND_* events

export class SoundEngine {
  constructor() {
    this.enabled = true;
    this.ctx = null;
    this.volume = 0.28;
  }

  ensureCtx() {
    if (!this.enabled) return null;
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setEnabled(val) {
    this.enabled = !!val;
  }

  tone(freq, dur, type = "triangle", gainScale = 1, slideTo = null, delay = 0) {
    const ctx = this.ensureCtx();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
    }
    const peak = Math.max(0.001, this.volume * gainScale);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  play(soundId) {
    if (!this.enabled) return;
    switch (soundId) {
      case 0: // Bell / noise
        this.tone(520, 0.09, "sine", 0.45, 420);
        break;
      case 1: // SOUND_HIT
        this.tone(175, 0.09, "sawtooth", 0.7, 65);
        this.tone(95, 0.08, "triangle", 0.8, 45);
        break;
      case 2: // SOUND_MISS
        this.tone(320, 0.07, "sine", 0.3, 180);
        break;
      case 3: // SOUND_FLEE
        this.tone(440, 0.12, "triangle", 0.4, 240);
        break;
      case 4: // SOUND_DROP
        this.tone(240, 0.08, "sine", 0.35, 140);
        break;
      case 5: // SOUND_KILL
      case 30: // SOUND_N_KILL
        this.tone(260, 0.12, "sawtooth", 0.65, 95);
        this.tone(520, 0.16, "triangle", 0.55, 780, 0.04);
        break;
      case 31: // SOUND_U_KILL
      case 32: // SOUND_QUEST
        this.tone(440, 0.15, "triangle", 0.65);
        this.tone(554, 0.15, "triangle", 0.65, null, 0.08);
        this.tone(659, 0.22, "triangle", 0.7, null, 0.16);
        this.tone(880, 0.32, "sine", 0.7, null, 0.24);
        break;
      case 6: // SOUND_LEVEL
      case 49: // SOUND_WINNER
        this.tone(392, 0.14, "triangle", 0.7);
        this.tone(494, 0.14, "triangle", 0.7, null, 0.09);
        this.tone(587, 0.16, "triangle", 0.75, null, 0.18);
        this.tone(784, 0.35, "sine", 0.8, null, 0.27);
        break;
      case 7: // SOUND_DEATH
        this.tone(220, 0.35, "sawtooth", 0.6, 110);
        this.tone(165, 0.45, "triangle", 0.65, 73, 0.18);
        break;
      case 8: // SOUND_STUDY
      case 25: // SOUND_SCROLL
        this.tone(520, 0.11, "sine", 0.45, 740);
        this.tone(740, 0.14, "sine", 0.4, 980, 0.06);
        break;
      case 9: // SOUND_TELEPORT
      case 14: // SOUND_TPOTHER
      case 24: // SOUND_TPLEVEL
        this.tone(280, 0.18, "sine", 0.55, 1100);
        this.tone(880, 0.14, "triangle", 0.35, 340, 0.08);
        break;
      case 10: // SOUND_SHOOT
        this.tone(480, 0.08, "triangle", 0.5, 190);
        break;
      case 11: // SOUND_QUAFF
      case 33: // SOUND_HEAL
      case 34: // SOUND_X_HEAL
        this.tone(460, 0.1, "sine", 0.5, 680);
        this.tone(680, 0.14, "sine", 0.5, 920, 0.06);
        break;
      case 12: // SOUND_ZAP
      case 37: // SOUND_M_SPELL
      case 40: // SOUND_BALL
      case 42: // SOUND_ATK_SPELL
        this.tone(660, 0.16, "sawtooth", 0.45, 220);
        this.tone(880, 0.12, "sine", 0.35, 420, 0.03);
        break;
      case 13: // SOUND_WALK
        this.tone(120, 0.025, "sine", 0.12, 85);
        break;
      case 15: // SOUND_HITWALL
        this.tone(110, 0.07, "square", 0.35, 70);
        break;
      case 16: // SOUND_EAT
        this.tone(220, 0.06, "triangle", 0.3, 180);
        this.tone(250, 0.06, "triangle", 0.3, 190, 0.07);
        break;
      case 21: // SOUND_DIG
        this.tone(180, 0.08, "square", 0.4, 95);
        break;
      case 22: // SOUND_OPENDOOR
      case 23: // SOUND_SHUTDOOR
        this.tone(160, 0.11, "triangle", 0.45, 240);
        break;
      case 26: // SOUND_BUY
      case 27: // SOUND_SELL
        this.tone(988, 0.07, "sine", 0.45);
        this.tone(1318, 0.14, "sine", 0.45, null, 0.06);
        break;
      case 28: // SOUND_WARN
      case 43: // SOUND_EVIL
        this.tone(330, 0.12, "sawtooth", 0.5, 220);
        this.tone(290, 0.16, "sawtooth", 0.5, 190, 0.13);
        break;
      default:
        if (soundId >= 35 && soundId <= 48) {
          this.tone(240, 0.12, "sawtooth", 0.45, 120);
        }
        break;
    }
  }
}

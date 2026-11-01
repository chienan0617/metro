/**
 * 極簡音效管理：以 WebAudio 產生短促音效，不需要外部音訊檔。
 * 必須在使用者互動後才會建立 AudioContext；可在設定中關閉。
 */

export type SoundName = "click" | "build" | "success" | "error" | "levelup" | "coin";

interface ToneSpec {
  frequency: number;
  duration: number;
  type: OscillatorType;
  gain: number;
  /** 下滑或上滑的目標頻率（選用）。 */
  slideTo?: number;
  delay?: number;
}

const TONES: Record<SoundName, ToneSpec[]> = {
  click: [{ frequency: 640, duration: 0.045, type: "triangle", gain: 0.05 }],
  build: [
    { frequency: 320, duration: 0.09, type: "square", gain: 0.045 },
    { frequency: 480, duration: 0.12, type: "square", gain: 0.045, delay: 0.08 },
  ],
  success: [
    { frequency: 520, duration: 0.09, type: "sine", gain: 0.06 },
    { frequency: 780, duration: 0.16, type: "sine", gain: 0.06, delay: 0.08 },
  ],
  levelup: [
    { frequency: 440, duration: 0.09, type: "sine", gain: 0.06 },
    { frequency: 660, duration: 0.09, type: "sine", gain: 0.06, delay: 0.09 },
    { frequency: 880, duration: 0.22, type: "sine", gain: 0.07, delay: 0.18 },
  ],
  error: [{ frequency: 220, duration: 0.18, type: "sawtooth", gain: 0.05, slideTo: 140 }],
  coin: [{ frequency: 900, duration: 0.07, type: "triangle", gain: 0.05, slideTo: 1250 }],
};

class SoundManager {
  private enabled = true;
  private context: AudioContext | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  play(name: SoundName): void {
    if (!this.enabled) {
      return;
    }
    const context = this.ensureContext();
    if (!context) {
      return;
    }
    for (const tone of TONES[name]) {
      this.scheduleTone(context, tone);
    }
  }

  private ensureContext(): AudioContext | null {
    if (this.context) {
      if (this.context.state === "suspended") {
        void this.context.resume();
      }
      return this.context;
    }
    try {
      const Ctor = window.AudioContext;
      if (!Ctor) {
        return null;
      }
      this.context = new Ctor();
      return this.context;
    } catch {
      return null;
    }
  }

  private scheduleTone(context: AudioContext, tone: ToneSpec): void {
    const start = context.currentTime + (tone.delay ?? 0);
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = tone.type;
    oscillator.frequency.setValueAtTime(tone.frequency, start);
    if (tone.slideTo) {
      oscillator.frequency.linearRampToValueAtTime(tone.slideTo, start + tone.duration);
    }
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(tone.gain, start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + tone.duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + tone.duration + 0.02);
  }
}

export const sound = new SoundManager();

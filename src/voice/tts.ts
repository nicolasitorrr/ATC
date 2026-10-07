import type { TtsRequest } from '../../shared/types';
import type { Transmission } from '../sim/engine';

export type TtsEngine = 'browser' | 'cloud' | 'off';

/**
 * The frequency: pilot transmissions are spoken one at a time, and nobody
 * talks while the controller is holding push-to-talk.
 */
export class Radio {
  engine: TtsEngine = 'browser';
  speechRate = 1;
  noise = 0.3;

  private queue: Transmission[] = [];
  private playing = false;
  private held = false;
  private audio: AudioContext | null = null;

  enqueue(t: Transmission): void {
    if (this.engine === 'off') return;
    this.queue.push(t);
    if (this.queue.length > 8) this.queue.shift(); // a hopelessly blocked frequency drops the oldest call
    void this.pump();
  }

  hold(on: boolean): void {
    this.held = on;
    if (!on) void this.pump();
  }

  clear(): void {
    this.queue = [];
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    void this.audio?.close();
    this.audio = null;
  }

  private async pump(): Promise<void> {
    if (this.playing || this.held) return;
    const next = this.queue.shift();
    if (!next) return;
    this.playing = true;
    try {
      if (this.engine === 'cloud') await this.speakCloud(next).catch(() => this.speakBrowser(next));
      else await this.speakBrowser(next);
    } finally {
      this.playing = false;
      void this.pump();
    }
  }

  private speakBrowser(t: Transmission): Promise<void> {
    if (!('speechSynthesis' in window)) return Promise.resolve();
    return new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(t.spoken);
      const voices = speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith(t.lang));
      if (voices.length) u.voice = voices[t.voice % voices.length];
      u.lang = t.lang === 'es' ? 'es-ES' : 'en-GB';
      u.rate = Math.min(2, Math.max(0.5, 1.15 * this.speechRate));
      u.pitch = 0.8 + (t.voice % 7) / 15;
      const timeout = setTimeout(resolve, 25000); // some browsers never fire onend
      u.onend = u.onerror = () => {
        clearTimeout(timeout);
        resolve();
      };
      speechSynthesis.speak(u);
    });
  }

  private async speakCloud(t: Transmission): Promise<void> {
    const body: TtsRequest = { text: t.spoken, voice: t.voice, speed: Math.min(1.6, 1.1 * this.speechRate), lang: t.lang };
    const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`tts ${r.status}`);
    const ctx = (this.audio ??= new AudioContext());
    const buffer = await ctx.decodeAudioData(await r.arrayBuffer());

    // VHF radio colouring: narrow band, a little clipping, static underneath.
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const high = ctx.createBiquadFilter();
    high.type = 'highpass';
    high.frequency.value = 350;
    const low = ctx.createBiquadFilter();
    low.type = 'lowpass';
    low.frequency.value = 3200;
    const clip = ctx.createWaveShaper();
    clip.curve = Float32Array.from({ length: 256 }, (_, i) => Math.tanh(((i - 128) / 128) * 2.5));
    source.connect(high).connect(low).connect(clip).connect(ctx.destination);

    const noise = ctx.createBufferSource();
    const samples = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = samples.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noise.buffer = samples;
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = this.noise * 0.06;
    noise.connect(noiseGain).connect(ctx.destination);

    await new Promise<void>((resolve) => {
      source.onended = () => {
        noise.stop();
        resolve();
      };
      noise.start();
      source.start();
    });
  }
}

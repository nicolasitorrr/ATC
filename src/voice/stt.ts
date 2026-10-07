import type { Lang, SttRequest } from '../../shared/types';

export type SttEngine = 'browser' | 'cloud';

export interface Recognizer {
  /** Start listening. `onInterim` receives partial text when the engine provides it. */
  start(lang: Lang, hint: string, onInterim: (text: string) => void): Promise<void>;
  /** Stop listening and return what was said. */
  stop(): Promise<string>;
}

// The Web Speech API is not in TypeScript's DOM typings.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | undefined {
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition) as (new () => SpeechRecognitionLike) | undefined;
}

export const browserSttSupported = (): boolean => !!speechRecognitionCtor();

class BrowserRecognizer implements Recognizer {
  private rec: SpeechRecognitionLike | null = null;
  private text = '';

  async start(lang: Lang, _hint: string, onInterim: (text: string) => void): Promise<void> {
    const Ctor = speechRecognitionCtor();
    if (!Ctor) throw new Error('Este navegador no soporta reconocimiento de voz (usa Chrome o Edge).');
    const rec = new Ctor();
    rec.lang = lang === 'es' ? 'es-ES' : 'en-US';
    rec.continuous = true;
    rec.interimResults = true;
    this.text = '';
    rec.onresult = (e) => {
      this.text = Array.from(e.results, (r) => r[0].transcript).join(' ');
      onInterim(this.text);
    };
    this.rec = rec;
    rec.start();
  }

  stop(): Promise<string> {
    const rec = this.rec;
    this.rec = null;
    if (!rec) return Promise.resolve('');
    return new Promise((resolve) => {
      const done = () => resolve(this.text.trim());
      const timeout = setTimeout(done, 2000);
      rec.onend = () => {
        clearTimeout(timeout);
        done();
      };
      rec.stop();
    });
  }
}

class CloudRecognizer implements Recognizer {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private lang: Lang = 'en';
  private hint = '';

  async start(lang: Lang, hint: string): Promise<void> {
    this.lang = lang;
    this.hint = hint;
    this.stream ??= await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream);
    this.recorder.ondataavailable = (e) => this.chunks.push(e.data);
    this.recorder.start();
  }

  async stop(): Promise<string> {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return '';
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      recorder.stop();
    });
    const blob = new Blob(this.chunks, { type: recorder.mimeType });
    if (blob.size < 1500) return ''; // an accidental tap
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    const body: SttRequest = { audio: dataUrl.slice(dataUrl.indexOf(',') + 1), mime: blob.type, lang: this.lang, hint: this.hint };
    const r = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Transcripción fallida (${r.status})`);
    return ((await r.json()) as { text: string }).text.trim();
  }
}

export function createRecognizer(engine: SttEngine): Recognizer {
  return engine === 'cloud' ? new CloudRecognizer() : new BrowserRecognizer();
}

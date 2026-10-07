import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import express from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Health, InterpretRequest, SttRequest, TtsRequest } from '../shared/types';
import { MODEL, interpret } from './interpret';

const app = express();
app.use(express.json({ limit: '20mb' }));

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const STT_MODEL = process.env.OPENAI_STT_MODEL || 'gpt-4o-mini-transcribe';
const TTS_MODEL = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
const TTS_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer'];

app.get('/api/health', (_req, res) => {
  const health: Health = {
    claude: !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN),
    model: MODEL,
    stt: !!OPENAI_KEY,
    tts: !!OPENAI_KEY,
  };
  res.json(health);
});

app.post('/api/interpret', async (req, res) => {
  const body = req.body as InterpretRequest;
  if (!body?.transcript || !body.context) return res.status(400).json({ error: 'transcript and context are required' });
  try {
    res.json(await interpret(body));
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return res.status(503).json({ error: 'Claude API key missing or invalid' });
    if (error instanceof Anthropic.RateLimitError) return res.status(429).json({ error: 'Claude rate limit' });
    if (error instanceof Anthropic.APIError) return res.status(502).json({ error: `Claude API error ${error.status}: ${error.message}` });
    // no credentials at all surfaces as a plain Error from the SDK constructor
    res.status(503).json({ error: error instanceof Error ? error.message : 'interpretation failed' });
  }
});

/** Express 4 does not catch rejected async handlers; a network failure must not take the server down. */
const safe =
  (fn: (req: express.Request, res: express.Response) => Promise<unknown>): express.RequestHandler =>
  (req, res) => {
    fn(req, res).catch((error) => res.status(502).json({ error: error instanceof Error ? error.message : String(error) }));
  };

app.post('/api/stt', safe(async (req, res) => {
  if (!OPENAI_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  const { audio, mime, lang, hint } = req.body as SttRequest;
  if (!audio) return res.status(400).json({ error: 'audio is required' });
  const form = new FormData();
  const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
  form.append('file', new Blob([Buffer.from(audio, 'base64')], { type: mime }), `tx.${ext}`);
  form.append('model', STT_MODEL);
  form.append('language', lang);
  form.append('prompt', `Air traffic control radio transmission. ${hint}`);
  const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: form });
  if (!r.ok) return res.status(502).json({ error: `transcription failed (${r.status}): ${await r.text()}` });
  const data = (await r.json()) as { text: string };
  res.json({ text: data.text });
}));

app.post('/api/tts', safe(async (req, res) => {
  if (!OPENAI_KEY) return res.status(503).json({ error: 'OPENAI_API_KEY not configured' });
  const { text, voice, speed, lang } = req.body as TtsRequest;
  if (!text) return res.status(400).json({ error: 'text is required' });
  const r = await fetch('https://api.openai.com/v1/audio/speech', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice: TTS_VOICES[Math.abs(voice) % TTS_VOICES.length],
      input: text,
      speed,
      response_format: 'mp3',
      instructions: `You are an airline pilot talking to air traffic control on the radio, in ${lang === 'es' ? 'Spanish' : 'English'}. Speak quickly, flat and clipped, with no pauses for commas.`,
    }),
  });
  if (!r.ok) return res.status(502).json({ error: `speech synthesis failed (${r.status}): ${await r.text()}` });
  res.setHeader('Content-Type', 'audio/mpeg');
  res.send(Buffer.from(await r.arrayBuffer()));
}));

// In production the same server also serves the built client.
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
if (existsSync(dist)) {
  app.use(express.static(dist));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 8787;
app.listen(port, () => console.log(`ATC sim API on http://localhost:${port}`));

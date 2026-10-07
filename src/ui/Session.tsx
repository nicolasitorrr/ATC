import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Health, Interpretation, InterpretRequest, Lang } from '../../shared/types';
import { LEBL } from '../sim/airports';
import type { SimParams } from '../sim/difficulty';
import { type Aircraft, Sim, type Transmission } from '../sim/engine';
import { parseTransmission } from '../sim/parser';
import { type SttEngine, createRecognizer } from '../voice/stt';
import { Radio, type TtsEngine } from '../voice/tts';
import { Radar } from './Radar';

export interface Settings {
  params: SimParams;
  interpreter: 'auto' | 'claude' | 'local';
  stt: SttEngine;
  tts: TtsEngine;
  micLang: Lang;
}

interface Props {
  settings: Settings;
  health: Health | null;
  onExit: () => void;
}

const clock = (t: number) => {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function Session({ settings, health, onExit }: Props) {
  const sim = useMemo(() => new Sim(LEBL, settings.params), [settings]);
  const radio = useMemo(() => new Radio(), []);
  const recognizer = useMemo(() => createRecognizer(settings.stt), [settings.stt]);

  const [log, setLog] = useState<Transmission[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [timeScale, setTimeScale] = useState(settings.params.timeScale);
  const [micLang, setMicLang] = useState<Lang>(settings.micLang);
  const [talking, setTalking] = useState(false);
  const [interim, setInterim] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [, setTick] = useState(0);

  const live = useRef({ paused, timeScale, selected, micLang });
  live.current = { paused, timeScale, selected, micLang };
  const claudeDown = useRef(false);
  const atcId = useRef(-1);
  const logEnd = useRef<HTMLDivElement>(null);

  // simulation loop
  useEffect(() => {
    radio.engine = settings.tts;
    radio.speechRate = settings.params.speechRate;
    radio.noise = settings.params.radioNoise;
    sim.onTransmission = (t) => {
      setLog((l) => [...l.slice(-199), t]);
      if (t.from === 'pilot') radio.enqueue(t);
    };
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      frame = requestAnimationFrame(loop);
      const dt = Math.min(0.25, (now - last) / 1000);
      last = now;
      if (!live.current.paused) sim.advance(dt * live.current.timeScale);
    };
    frame = requestAnimationFrame(loop);
    const ui = setInterval(() => setTick((n) => n + 1), 500);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(ui);
      radio.clear();
    };
  }, [sim, radio, settings]);

  useEffect(() => logEnd.current?.scrollIntoView({ block: 'end' }), [log]);

  const submit = useCallback(
    async (text: string, viaVoice: boolean) => {
      const transcript = text.trim();
      if (!transcript) return;
      const ctx = sim.context(live.current.selected);
      const local = parseTransmission(transcript, ctx);
      let interp: Interpretation = local;

      // Typed input the rules already resolve needs no model round-trip; speech always benefits from one.
      const confident = !viaVoice && !!local.callsign && local.understood;
      const wantClaude = settings.interpreter === 'claude' || (settings.interpreter === 'auto' && !!health?.claude && !claudeDown.current);
      if (wantClaude && !local.shorthand && !confident) {
        setBusy(true);
        try {
          const body: InterpretRequest = { transcript, context: ctx };
          const r = await fetch('/api/interpret', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!r.ok) throw new Error(((await r.json()) as { error?: string }).error ?? `HTTP ${r.status}`);
          interp = (await r.json()) as Interpretation;
        } catch (error) {
          // credentials problems will not fix themselves mid-session; transient ones may
          if (error instanceof Error && /key|credential|503/i.test(error.message)) claudeDown.current = true;
          setNotice(`Claude no disponible (${error instanceof Error ? error.message : 'error'}); usando el intérprete local.`);
        } finally {
          setBusy(false);
        }
      }

      const target = sim.findByCallsign(interp.callsign) ?? sim.findByCallsign(live.current.selected);
      const shown = local.shorthand && target ? sim.controllerPhrase(target, interp.commands).text : transcript;
      setLog((l) => [...l.slice(-199), { id: atcId.current--, time: sim.time, from: 'atc', callsign: target?.callsign ?? null, text: shown, spoken: '', lang: 'en', voice: 0 }]);
      sim.handleController(interp, live.current.selected);
      if (target) setSelected(target.callsign);
    },
    [sim, settings.interpreter, health],
  );

  // push to talk
  const pttDown = useCallback(async () => {
    if (talking) return;
    setTalking(true);
    setInterim('');
    setNotice('');
    radio.hold(true);
    const hint = sim.aircraft.map((a) => `${a.telephony} ${a.callsign.replace(/^[A-Z]+/, '')}`).join(', ') + '. ' + sim.airport.fixes.map((f) => f.name).join(', ');
    try {
      await recognizer.start(live.current.micLang, hint, setInterim);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'No se pudo abrir el micrófono.');
      setTalking(false);
      radio.hold(false);
    }
  }, [talking, radio, recognizer, sim]);

  const pttUp = useCallback(async () => {
    if (!talking) return;
    setTalking(false);
    try {
      const text = await recognizer.stop();
      if (text) await submit(text, true);
      else setNotice('No se ha entendido nada. Mantén pulsado mientras hablas.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Error de reconocimiento de voz.');
    } finally {
      setInterim('');
      radio.hold(false);
    }
  }, [talking, recognizer, submit, radio]);

  useEffect(() => {
    const typing = () => document.activeElement instanceof HTMLInputElement;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat && !typing()) {
        e.preventDefault();
        void pttDown();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing()) {
        e.preventDefault(); // otherwise a focused button would be clicked
        void pttUp();
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [pttDown, pttUp]);

  const [draft, setDraft] = useState('');
  const strips = [...sim.aircraft].sort((a, b) => rank(a) - rank(b) || a.spawnTime - b.spawnTime);
  const { windDir, windSpeed } = settings.params;

  return (
    <div className="session">
      <header className="topbar">
        <strong>{sim.airport.icao} APP</strong>
        <span className="mono">{clock(12 * 3600 + sim.time)}Z</span>
        <span>
          Viento {String(windDir).padStart(3, '0')}°/{windSpeed} kt
        </span>
        <span>
          Pista ARR {sim.airport.arrivalRunway} · DEP {sim.airport.departureRunway}
        </span>
        <span className="score">Puntos {Math.round(sim.score)}</span>
        <span>
          ⬇ {sim.stats.landed} · ⬆ {sim.stats.departed} · ⚠ {sim.stats.incidents} · ↺ {sim.stats.goArounds}
        </span>
        <span className="spacer" />
        {[1, 2, 4].map((x) => (
          <button key={x} className={timeScale === x ? 'on' : ''} onClick={() => setTimeScale(x)}>
            x{x}
          </button>
        ))}
        <button onClick={() => setPaused((p) => !p)}>{paused ? '▶ Reanudar' : '⏸ Pausa'}</button>
        <button onClick={onExit}>Terminar</button>
      </header>

      <Radar sim={sim} selected={selected} onSelect={setSelected} />

      <aside className="strips">
        {strips.map((a) => (
          <Strip key={a.id} a={a} selected={a.callsign === selected} onClick={() => setSelected(a.callsign)} />
        ))}
        {!strips.length && <p className="muted">Sin tráfico todavía.</p>}
      </aside>

      <section className="comms">
        <div className="log">
          {log.map((t) => (
            <div key={t.id} className={`line ${t.from}`}>
              <span className="mono time">{clock(t.time).slice(3)}</span>
              <span className="who">{t.from === 'atc' ? 'APP' : t.from === 'pilot' ? t.callsign : '···'}</span>
              <span>{t.text}</span>
            </div>
          ))}
          <div ref={logEnd} />
        </div>
        <form
          className="input"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(draft, false);
            setDraft('');
          }}
        >
          <button type="button" className={`ptt ${talking ? 'on' : ''}`} onPointerDown={() => void pttDown()} onPointerUp={() => void pttUp()} onPointerLeave={() => void pttUp()}>
            {talking ? '● Transmitiendo' : '🎙 PTT (Espacio)'}
          </button>
          <button type="button" title="Idioma en el que hablas al micrófono" onClick={() => setMicLang((l) => (l === 'en' ? 'es' : 'en'))}>
            {micLang.toUpperCase()}
          </button>
          <input
            value={talking ? interim : draft}
            readOnly={talking}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={selected ? `${selected}: h 250 · a 5000 · s 210 · d SLL · ils · twr — o fraseología completa` : 'Selecciona un avión o escribe el indicativo: VLG1234 h 250 a 5000'}
          />
          <button type="submit" disabled={busy}>
            {busy ? '…' : 'Enviar'}
          </button>
        </form>
        {notice && <div className="notice">{notice}</div>}
      </section>
    </div>
  );
}

const rank = (a: Aircraft) => (a.emergency ? 0 : a.status === 'active' ? 1 : a.status === 'pending' ? 2 : 3);

function Strip({ a, selected, onClick }: { a: Aircraft; selected: boolean; onClick: () => void }) {
  const state = a.conflict ? 'conflict' : a.emergency ? 'emergency' : a.status;
  const fl = (ft: number) => String(Math.round(ft / 100)).padStart(3, '0');
  const route = a.kind === 'arrival' ? (a.established ? `ILS ${a.ilsRunway!.id} establecido` : a.ilsRunway ? `ILS ${a.ilsRunway.id} autorizado` : `desde ${a.entryFix}`) : `salida → ${a.exitFix}`;
  const owner = a.status === 'tower' ? 'TWR' : a.status === 'center' ? 'CTR' : a.status === 'pending' ? 'llamando…' : '';
  return (
    <button className={`strip ${state} ${a.kind} ${selected ? 'selected' : ''}`} onClick={onClick}>
      <div className="row">
        <strong>{a.callsign}</strong>
        <span>
          {a.type}/{a.perf.wake}
        </span>
        <span className="lang">{a.lang.toUpperCase()}</span>
        <span className="owner">{a.emergency ? 'EMERGENCIA' : owner}</span>
      </div>
      <div className="row mono">
        <span>
          {fl(a.alt)}→{fl(a.tgtAlt)}
        </span>
        <span>{a.nav === 'direct' && a.directFix ? `→${a.directFix.name}` : `H${String(Math.round(a.tgtHdg)).padStart(3, '0')}`}</span>
        <span>
          {Math.round(a.ias)}
          {a.speedAssigned ? `→${a.tgtSpd}` : ''} kt
        </span>
      </div>
      <div className="row muted">{route}</div>
    </button>
  );
}

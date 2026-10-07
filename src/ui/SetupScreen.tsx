import { useState } from 'react';
import type { Health } from '../../shared/types';
import { PRESETS, type PresetId, type SimParams } from '../sim/difficulty';
import { browserSttSupported } from '../voice/stt';
import type { Settings } from './Session';

interface Props {
  health: Health | null;
  onStart: (settings: Settings) => void;
}

interface Slider {
  key: keyof SimParams;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

const SLIDERS: { title: string; items: Slider[] }[] = [
  {
    title: 'Tráfico',
    items: [
      { key: 'arrivalsPerHour', label: 'Llegadas por hora', min: 0, max: 60, step: 1 },
      { key: 'departuresPerHour', label: 'Salidas por hora', min: 0, max: 40, step: 1 },
      { key: 'maxAircraft', label: 'Máximo de aviones simultáneos', min: 2, max: 30, step: 1 },
      { key: 'initialTraffic', label: 'Tráfico inicial', min: 0, max: 8, step: 1 },
    ],
  },
  {
    title: 'Pilotos',
    items: [
      { key: 'pilotErrorRate', label: 'Colaciones erróneas', min: 0, max: 0.3, step: 0.01, format: pct },
      { key: 'sayAgainRate', label: '"Repita" / say again', min: 0, max: 0.2, step: 0.01, format: pct },
      { key: 'emergencyRate', label: 'Emergencias', min: 0, max: 0.2, step: 0.01, format: pct },
      { key: 'pilotRequestRate', label: 'Peticiones espontáneas', min: 0, max: 1, step: 0.05, format: pct },
    ],
  },
  {
    title: 'Entorno',
    items: [
      { key: 'windDir', label: 'Dirección del viento', min: 10, max: 360, step: 10, format: (v) => `${String(v).padStart(3, '0')}°` },
      { key: 'windSpeed', label: 'Intensidad del viento', min: 0, max: 40, step: 1, format: (v) => `${v} kt` },
      { key: 'separationNm', label: 'Separación radar mínima', min: 2.5, max: 5, step: 0.5, format: (v) => `${v} NM` },
      { key: 'timeScale', label: 'Velocidad de simulación', min: 1, max: 4, step: 1, format: (v) => `x${v}` },
    ],
  },
  {
    title: 'Radio',
    items: [
      { key: 'speechRate', label: 'Velocidad de habla', min: 0.7, max: 1.5, step: 0.05, format: (v) => `x${v.toFixed(2)}` },
      { key: 'radioNoise', label: 'Ruido de radio (voz en la nube)', min: 0, max: 1, step: 0.05, format: pct },
    ],
  },
];

export function SetupScreen({ health, onStart }: Props) {
  const [preset, setPreset] = useState<PresetId | 'custom'>('normal');
  const [params, setParams] = useState<SimParams>(PRESETS.normal.params);
  const [interpreter, setInterpreter] = useState<Settings['interpreter']>('auto');
  const [stt, setStt] = useState<Settings['stt']>('browser');
  const [tts, setTts] = useState<Settings['tts']>('browser');
  const [cloudDefaulted, setCloudDefaulted] = useState(false);

  // once we know the server has audio keys, prefer the better engines
  if (health?.stt && !cloudDefaulted) {
    setCloudDefaulted(true);
    setStt('cloud');
    setTts('cloud');
  }

  const set = <K extends keyof SimParams>(key: K, value: SimParams[K]) => {
    setParams((p) => ({ ...p, [key]: value }));
    setPreset('custom');
  };

  return (
    <div className="setup">
      <h1>ATC Sim · Barcelona Aproximación</h1>
      <p className="muted">Eres el controlador de aproximación de LEBL. Vectoriza las llegadas al ILS 25R, transfiérelas a torre, y saca las salidas de la 25L hacia su punto de salida antes de pasarlas a control. Los pilotos son IA y te colacionan por voz.</p>

      <h2>Dificultad</h2>
      <div className="presets">
        {(Object.keys(PRESETS) as PresetId[]).map((id) => (
          <button
            key={id}
            className={preset === id ? 'on' : ''}
            onClick={() => {
              setPreset(id);
              setParams(PRESETS[id].params);
            }}
          >
            <strong>{PRESETS[id].label}</strong>
            <small>{PRESETS[id].description}</small>
          </button>
        ))}
      </div>
      {preset === 'custom' && <p className="muted">Parámetros personalizados.</p>}

      <div className="groups">
        {SLIDERS.map((group) => (
          <fieldset key={group.title}>
            <legend>{group.title}</legend>
            {group.items.map((s) => {
              const value = params[s.key] as number;
              return (
                <label key={s.key}>
                  <span>{s.label}</span>
                  <input type="range" min={s.min} max={s.max} step={s.step} value={value} onChange={(e) => set(s.key, +e.target.value as never)} />
                  <output>{s.format ? s.format(value) : value}</output>
                </label>
              );
            })}
            {group.title === 'Entorno' && (
              <label>
                <span>Separación por estela turbulenta</span>
                <input type="checkbox" checked={params.wakeSeparation} onChange={(e) => set('wakeSeparation', e.target.checked)} />
                <output />
              </label>
            )}
            {group.title === 'Pilotos' && (
              <label>
                <span>Idioma en frecuencia</span>
                <select value={params.language} onChange={(e) => set('language', e.target.value as SimParams['language'])}>
                  <option value="mixed">Mixto (compañías españolas en español)</option>
                  <option value="en">Solo inglés</option>
                  <option value="es">Solo español</option>
                </select>
                <output />
              </label>
            )}
          </fieldset>
        ))}

        <fieldset>
          <legend>Voz e IA</legend>
          <label>
            <span>Intérprete de fraseología</span>
            <select value={interpreter} onChange={(e) => setInterpreter(e.target.value as Settings['interpreter'])}>
              <option value="auto">Automático (Claude para la voz)</option>
              <option value="claude">Siempre Claude</option>
              <option value="local">Solo reglas locales</option>
            </select>
            <output />
          </label>
          <label>
            <span>Reconocimiento de voz</span>
            <select value={stt} onChange={(e) => setStt(e.target.value as Settings['stt'])}>
              <option value="browser">Navegador{browserSttSupported() ? '' : ' (no soportado aquí)'}</option>
              <option value="cloud" disabled={!health?.stt}>
                Nube (OpenAI)
              </option>
            </select>
            <output />
          </label>
          <label>
            <span>Voces de los pilotos</span>
            <select value={tts} onChange={(e) => setTts(e.target.value as Settings['tts'])}>
              <option value="browser">Navegador</option>
              <option value="cloud" disabled={!health?.tts}>
                Nube (OpenAI, con efecto radio)
              </option>
              <option value="off">Sin voz (solo texto)</option>
            </select>
            <output />
          </label>
          <p className="muted status">
            {health === null
              ? 'Servidor de API no disponible: solo intérprete local y voz del navegador.'
              : `Claude: ${health.claude ? `listo (${health.model})` : 'sin clave'} · Audio en la nube: ${health.stt ? 'listo' : 'sin clave'}`}
          </p>
        </fieldset>
      </div>

      <button className="start" onClick={() => onStart({ params, interpreter, stt, tts, micLang: params.language === 'es' ? 'es' : 'en' })}>
        Empezar sesión
      </button>
    </div>
  );
}

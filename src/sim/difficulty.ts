export interface SimParams {
  arrivalsPerHour: number;
  departuresPerHour: number;
  maxAircraft: number;
  /** aircraft already inbound when the session starts */
  initialTraffic: number;
  /** probability that a pilot reads back (and flies) a wrong value */
  pilotErrorRate: number;
  /** probability that a pilot asks to say again */
  sayAgainRate: number;
  /** probability that an arrival declares an emergency */
  emergencyRate: number;
  /** how often pilots come up with their own requests, 0..1 */
  pilotRequestRate: number;
  /** seconds before a pilot answers: [min, max] */
  responseDelay: [number, number];
  windDir: number;
  windSpeed: number;
  separationNm: number;
  separationFt: number;
  wakeSeparation: boolean;
  /** en: everyone speaks English. es: everyone Spanish. mixed: Spanish airlines speak Spanish */
  language: 'en' | 'es' | 'mixed';
  speechRate: number;
  /** radio static level, 0..1 */
  radioNoise: number;
  timeScale: number;
}

export type PresetId = 'student' | 'easy' | 'normal' | 'hard' | 'expert';

const base: SimParams = {
  arrivalsPerHour: 22,
  departuresPerHour: 14,
  maxAircraft: 12,
  initialTraffic: 3,
  pilotErrorRate: 0.05,
  sayAgainRate: 0.04,
  emergencyRate: 0.02,
  pilotRequestRate: 0.5,
  responseDelay: [0.8, 2.5],
  windDir: 250,
  windSpeed: 12,
  separationNm: 3,
  separationFt: 1000,
  wakeSeparation: true,
  language: 'mixed',
  speechRate: 1,
  radioNoise: 0.3,
  timeScale: 1,
};

export const PRESETS: Record<PresetId, { label: string; description: string; params: SimParams }> = {
  student: {
    label: 'Alumno (S1)',
    description: 'Muy poco tráfico, pilotos perfectos y sin viento. Para aprender la fraseología.',
    params: {
      ...base,
      arrivalsPerHour: 8,
      departuresPerHour: 4,
      maxAircraft: 4,
      initialTraffic: 1,
      pilotErrorRate: 0,
      sayAgainRate: 0,
      emergencyRate: 0,
      pilotRequestRate: 0.2,
      responseDelay: [1, 2],
      windSpeed: 0,
      wakeSeparation: false,
      speechRate: 0.9,
      radioNoise: 0,
    },
  },
  easy: {
    label: 'Fácil',
    description: 'Tráfico ligero y pilotos casi siempre correctos.',
    params: {
      ...base,
      arrivalsPerHour: 14,
      departuresPerHour: 8,
      maxAircraft: 7,
      initialTraffic: 2,
      pilotErrorRate: 0.02,
      sayAgainRate: 0.02,
      emergencyRate: 0,
      windSpeed: 8,
      wakeSeparation: false,
      radioNoise: 0.15,
    },
  },
  normal: {
    label: 'Normal',
    description: 'Una tarde corriente: colaciones erróneas ocasionales y estela turbulenta.',
    params: { ...base },
  },
  hard: {
    label: 'Difícil',
    description: 'Hora punta, más errores de colación, viento y alguna emergencia.',
    params: {
      ...base,
      arrivalsPerHour: 32,
      departuresPerHour: 20,
      maxAircraft: 18,
      initialTraffic: 5,
      pilotErrorRate: 0.08,
      sayAgainRate: 0.06,
      emergencyRate: 0.05,
      pilotRequestRate: 0.7,
      responseDelay: [0.6, 3.5],
      windDir: 290,
      windSpeed: 18,
      speechRate: 1.1,
      radioNoise: 0.5,
    },
  },
  expert: {
    label: 'Experto (C1)',
    description: 'Saturación total, pilotos rápidos y despistados, radio ruidosa y emergencias.',
    params: {
      ...base,
      arrivalsPerHour: 42,
      departuresPerHour: 28,
      maxAircraft: 26,
      initialTraffic: 7,
      pilotErrorRate: 0.12,
      sayAgainRate: 0.08,
      emergencyRate: 0.08,
      pilotRequestRate: 0.9,
      responseDelay: [0.5, 4],
      windDir: 310,
      windSpeed: 25,
      speechRate: 1.2,
      radioNoise: 0.7,
    },
  },
};

import { project } from './geo';

export interface Fix {
  name: string;
  x: number;
  y: number;
  kind: 'fix' | 'vor';
}

export interface Runway {
  id: string;
  /** landing threshold, NM from the airport reference point */
  thrX: number;
  thrY: number;
  heading: number;
  lengthNm: number;
}

export interface Airport {
  icao: string;
  name: string;
  elevation: number;
  approachName: { en: string; es: string };
  towerName: { en: string; es: string };
  centerName: { en: string; es: string };
  towerFreq: string;
  centerFreq: string;
  runways: Runway[];
  arrivalRunway: string;
  departureRunway: string;
  fixes: Fix[];
  /** where arrivals are handed to us, and the inner fix they proceed to */
  entries: { fix: string; to: string; altitude: number }[];
  exits: string[];
  radiusNm: number;
  transitionAltitude: number;
  /** altitude departures climb to before talking to us */
  initialClimb: number;
  /** departures should be cleared at least this high before handoff to centre */
  handoffAltitude: number;
  minVectoringAltitude: number;
  missedApproachAltitude: number;
}

/** Fix placed by bearing/distance from the airport reference point. */
function at(name: string, brg: number, d: number, kind: Fix['kind'] = 'fix'): Fix {
  const p = project(0, 0, brg, d);
  return { name, x: +p.x.toFixed(2), y: +p.y.toFixed(2), kind };
}

// Barcelona-El Prat, west configuration (landing 25R, departing 25L).
// Runway geometry is close to reality; fix names are real Barcelona TMA
// waypoints but their positions here are APPROXIMATE and laid out for
// gameplay. Not for real-world navigation.
export const LEBL: Airport = {
  icao: 'LEBL',
  name: 'Barcelona-El Prat',
  elevation: 14,
  approachName: { en: 'Barcelona Approach', es: 'Barcelona Aproximación' },
  towerName: { en: 'Barcelona Tower', es: 'Barcelona Torre' },
  centerName: { en: 'Barcelona Control', es: 'Barcelona Control' },
  towerFreq: '118.100',
  centerFreq: '133.125',
  runways: [
    { id: '25R', thrX: 0.83, thrY: 0.77, heading: 246, lengthNm: 1.81 },
    { id: '25L', thrX: 0.96, thrY: -0.11, heading: 246, lengthNm: 1.44 },
  ],
  arrivalRunway: '25R',
  departureRunway: '25L',
  fixes: [
    // entries
    at('ALBER', 48, 40),
    at('LESBA', 352, 40),
    at('RULOS', 282, 40),
    at('VIBIM', 222, 40),
    at('MATEX', 150, 40),
    // exits
    at('DALIN', 25, 42),
    at('GRAUS', 318, 42),
    at('MOPAS', 252, 42),
    at('LOTOS', 185, 42),
    at('NEPAL', 98, 42),
    // inner fixes
    at('SLL', 8, 13, 'vor'),
    at('BCN', 80, 1.2, 'vor'),
    at('VLA', 268, 20, 'vor'),
    at('ASTEK', 40, 20),
    at('RUBOT', 105, 20),
    at('SOTIL', 200, 18),
    // 25R final approach course
    at('TEBLA', 66, 17),
    at('BISBA', 66, 10),
  ],
  entries: [
    { fix: 'ALBER', to: 'ASTEK', altitude: 12000 },
    { fix: 'LESBA', to: 'SLL', altitude: 11000 },
    { fix: 'RULOS', to: 'SLL', altitude: 12000 },
    { fix: 'VIBIM', to: 'SOTIL', altitude: 11000 },
    { fix: 'MATEX', to: 'RUBOT', altitude: 10000 },
  ],
  exits: ['DALIN', 'GRAUS', 'MOPAS', 'LOTOS', 'NEPAL'],
  radiusNm: 45,
  transitionAltitude: 6000,
  initialClimb: 5000,
  handoffAltitude: 13000,
  minVectoringAltitude: 2000,
  missedApproachAltitude: 3000,
};

export const AIRPORTS: Record<string, Airport> = { LEBL };

export function findFix(airport: Airport, name: string): Fix | undefined {
  const n = name.toUpperCase();
  return airport.fixes.find((f) => f.name === n);
}

export function findRunway(airport: Airport, id: string): Runway | undefined {
  return airport.runways.find((r) => r.id === id.toUpperCase());
}

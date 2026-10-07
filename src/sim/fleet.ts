export type Wake = 'L' | 'M' | 'H';

export interface Perf {
  wake: Wake;
  /** feet per minute */
  climb: number;
  descent: number;
  /** knots IAS */
  vapp: number;
  minClean: number;
  cruise: number;
}

export const TYPES: Record<string, Perf> = {
  A320: { wake: 'M', climb: 2500, descent: 2200, vapp: 135, minClean: 200, cruise: 300 },
  A20N: { wake: 'M', climb: 2600, descent: 2200, vapp: 135, minClean: 200, cruise: 300 },
  A321: { wake: 'M', climb: 2300, descent: 2200, vapp: 140, minClean: 210, cruise: 300 },
  B738: { wake: 'M', climb: 2500, descent: 2200, vapp: 140, minClean: 205, cruise: 300 },
  B38M: { wake: 'M', climb: 2600, descent: 2200, vapp: 140, minClean: 205, cruise: 300 },
  E190: { wake: 'M', climb: 2400, descent: 2200, vapp: 130, minClean: 195, cruise: 290 },
  CRJX: { wake: 'M', climb: 2400, descent: 2200, vapp: 135, minClean: 200, cruise: 290 },
  AT76: { wake: 'M', climb: 1500, descent: 1600, vapp: 115, minClean: 160, cruise: 230 },
  C56X: { wake: 'L', climb: 3000, descent: 2400, vapp: 115, minClean: 170, cruise: 280 },
  A333: { wake: 'H', climb: 2000, descent: 2000, vapp: 140, minClean: 215, cruise: 310 },
  B788: { wake: 'H', climb: 2200, descent: 2000, vapp: 140, minClean: 215, cruise: 310 },
  B77W: { wake: 'H', climb: 1900, descent: 2000, vapp: 148, minClean: 225, cruise: 310 },
};

export interface Airline {
  icao: string;
  telephony: string;
  /** relative traffic share */
  weight: number;
  types: string[];
  /** crews speak Spanish on frequency when the session language is "mixed" */
  spanish: boolean;
}

export const AIRLINES: Airline[] = [
  { icao: 'VLG', telephony: 'Vueling', weight: 30, types: ['A320', 'A20N', 'A321'], spanish: true },
  { icao: 'IBE', telephony: 'Iberia', weight: 8, types: ['A320', 'A321', 'A333'], spanish: true },
  { icao: 'IBS', telephony: 'Iberexpres', weight: 5, types: ['A320', 'A321'], spanish: true },
  { icao: 'AEA', telephony: 'Europa', weight: 5, types: ['B738', 'B788'], spanish: true },
  { icao: 'ANE', telephony: 'Air Nostrum', weight: 4, types: ['CRJX', 'AT76'], spanish: true },
  { icao: 'RYR', telephony: 'Ryanair', weight: 14, types: ['B738', 'B38M'], spanish: false },
  { icao: 'EZY', telephony: 'Easy', weight: 7, types: ['A320', 'A20N'], spanish: false },
  { icao: 'DLH', telephony: 'Lufthansa', weight: 4, types: ['A320', 'A321'], spanish: false },
  { icao: 'BAW', telephony: 'Speedbird', weight: 4, types: ['A320', 'A20N'], spanish: false },
  { icao: 'AFR', telephony: 'Air France', weight: 4, types: ['A320', 'E190'], spanish: false },
  { icao: 'KLM', telephony: 'KLM', weight: 3, types: ['B738', 'E190'], spanish: false },
  { icao: 'SWR', telephony: 'Swiss', weight: 3, types: ['A320', 'A20N'], spanish: false },
  { icao: 'TAP', telephony: 'Air Portugal', weight: 3, types: ['A320', 'E190'], spanish: false },
  { icao: 'WZZ', telephony: 'Wizzair', weight: 3, types: ['A321'], spanish: false },
  { icao: 'UAE', telephony: 'Emirates', weight: 1, types: ['B77W'], spanish: false },
  { icao: 'QTR', telephony: 'Qatari', weight: 1, types: ['B788', 'B77W'], spanish: false },
  { icao: 'DAL', telephony: 'Delta', weight: 1, types: ['A333'], spanish: false },
  { icao: 'NJE', telephony: 'Fraction', weight: 2, types: ['C56X'], spanish: false },
];

export function findAirline(icao: string): Airline | undefined {
  return AIRLINES.find((a) => a.icao === icao.toUpperCase());
}

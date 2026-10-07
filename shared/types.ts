// Types shared by the browser client and the API server.

export const COMMAND_TYPES = [
  'heading',
  'present_heading',
  'altitude',
  'speed',
  'resume_speed',
  'direct',
  'ils',
  'contact',
  'go_around',
] as const;
export type CommandType = (typeof COMMAND_TYPES)[number];

export const QUERY_TYPES = ['say_altitude', 'say_heading', 'say_speed', 'radio_check'] as const;
export type QueryType = (typeof QUERY_TYPES)[number];

export type Lang = 'en' | 'es';

export interface Command {
  type: CommandType;
  /** heading in degrees, altitude in feet or speed in knots */
  value?: number | null;
  turn?: 'left' | 'right' | null;
  fix?: string | null;
  runway?: string | null;
  facility?: 'tower' | 'center' | null;
}

export interface Interpretation {
  /** ICAO callsign such as VLG1234, or null when none was recognised */
  callsign: string | null;
  commands: Command[];
  query: QueryType | null;
  /** free-form pilot reply for transmissions that are not plain instructions */
  reply: string | null;
  understood: boolean;
  source: 'claude' | 'local';
}

export interface InterpretContext {
  airport: string;
  approachName: string;
  transitionAltitude: number;
  arrivalRunway: string;
  departureRunway: string;
  fixes: string[];
  aircraft: {
    callsign: string;
    telephony: string;
    kind: 'arrival' | 'departure';
    altitude: number;
    heading: number;
    speed: number;
    lang: Lang;
  }[];
  /** aircraft selected on the radar, used when the transmission has no callsign */
  selected: string | null;
}

export interface InterpretRequest {
  transcript: string;
  context: InterpretContext;
}

export interface Health {
  claude: boolean;
  model: string;
  stt: boolean;
  tts: boolean;
}

export interface SttRequest {
  /** base64 encoded audio */
  audio: string;
  mime: string;
  lang: Lang;
  /** vocabulary hint: callsigns and fixes currently in play */
  hint: string;
}

export interface TtsRequest {
  text: string;
  voice: number;
  speed: number;
  lang: Lang;
}

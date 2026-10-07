import type { Command, Lang } from '../../shared/types';
import type { Airport } from './airports';

/** A radio phrase: what is shown in the log and what the TTS engine should say. */
export interface Phrase {
  text: string;
  spoken: string;
}

export const ph = (text: string, spoken: string = text): Phrase => ({ text, spoken });

export function join(parts: (Phrase | null | undefined | false)[], sep = ', '): Phrase {
  const ok = parts.filter((p): p is Phrase => !!p);
  return { text: ok.map((p) => p.text).join(sep), spoken: ok.map((p) => p.spoken).join(sep) };
}

const DIGITS: Record<Lang, string[]> = {
  en: ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'],
  es: ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve'],
};
const HUNDREDS_ES = ['', 'cien', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];

/** "250" -> "two five zero" */
export function digits(value: string | number, lang: Lang): string {
  return String(value)
    .split('')
    .map((c) => (c >= '0' && c <= '9' ? DIGITS[lang][+c] : c === '.' ? 'decimal' : c))
    .join(' ');
}

export function headingPhrase(hdg: number, lang: Lang): Phrase {
  const h = String(Math.round(hdg) === 0 ? 360 : Math.round(hdg)).padStart(3, '0');
  return ph(`${lang === 'en' ? 'heading' : 'rumbo'} ${h}`, `${lang === 'en' ? 'heading' : 'rumbo'} ${digits(h, lang)}`);
}

export function altitudePhrase(alt: number, lang: Lang, transitionAltitude: number): Phrase {
  if (alt > transitionAltitude) {
    const fl = String(Math.round(alt / 100)).padStart(3, '0');
    return ph(`FL${fl}`, `${lang === 'en' ? 'flight level' : 'nivel de vuelo'} ${digits(fl, lang)}`);
  }
  const rounded = Math.round(alt / 100) * 100;
  const th = Math.floor(rounded / 1000);
  const hu = (rounded % 1000) / 100;
  const words: string[] = [];
  if (lang === 'en') {
    if (th) words.push(`${digits(th, 'en')} thousand`);
    if (hu) words.push(`${DIGITS.en[hu]} hundred`);
    return ph(`${rounded} ft`, `${words.join(' ')} feet`);
  }
  if (th) words.push(th === 1 ? 'mil' : `${digits(th, 'es')} mil`);
  if (hu) words.push(HUNDREDS_ES[hu]);
  return ph(`${rounded} pies`, `${words.join(' ')} pies`);
}

export function speedPhrase(kts: number, lang: Lang): Phrase {
  const s = String(Math.round(kts));
  return lang === 'en' ? ph(`speed ${s} kt`, `speed ${digits(s, 'en')} knots`) : ph(`velocidad ${s} kt`, `velocidad ${digits(s, 'es')} nudos`);
}

export function runwayPhrase(id: string, lang: Lang): Phrase {
  const num = id.slice(0, 2);
  const side = id.slice(2);
  const sides: Record<Lang, Record<string, string>> = {
    en: { L: ' left', R: ' right', C: ' center', '': '' },
    es: { L: ' izquierda', R: ' derecha', C: ' centro', '': '' },
  };
  return ph(`${lang === 'en' ? 'runway' : 'pista'} ${id}`, `${lang === 'en' ? 'runway' : 'pista'} ${digits(num, lang)}${sides[lang][side] ?? ''}`);
}

export function freqPhrase(freq: string, lang: Lang): Phrase {
  const f = freq.replace(/0+$/, '').replace(/\.$/, '.0');
  return ph(f, digits(f, lang));
}

export function callsignPhrase(callsign: string, telephony: string, lang: Lang): Phrase {
  const number = callsign.replace(/^[A-Z]+/, '');
  return ph(callsign, `${telephony} ${digits(number, lang)}`);
}

export interface PhraseEnv {
  lang: Lang;
  airport: Airport;
  /** current altitude, to choose between "climb" and "descend" */
  altitude: number;
}

/** One instruction as spoken on the radio, used for readbacks and for the controller's own log line. */
export function commandPhrase(cmd: Command, env: PhraseEnv): Phrase {
  const { lang, airport } = env;
  const en = lang === 'en';
  switch (cmd.type) {
    case 'heading': {
      const turn = cmd.turn ? (en ? `turn ${cmd.turn} ` : `viraje ${cmd.turn === 'left' ? 'izquierda' : 'derecha'} `) : '';
      const h = headingPhrase(cmd.value ?? 0, lang);
      return ph(turn + h.text, turn + h.spoken);
    }
    case 'present_heading':
      return ph(en ? 'continue present heading' : 'mantener rumbo actual');
    case 'altitude': {
      const target = cmd.value ?? 0;
      const up = target > env.altitude + 100;
      const down = target < env.altitude - 100;
      const verb = en ? (up ? 'climb' : down ? 'descend' : 'maintain') : up ? 'ascenso' : down ? 'descenso' : 'mantener';
      const a = altitudePhrase(target, lang, airport.transitionAltitude);
      return ph(`${verb} ${a.text}`, `${verb} ${a.spoken}`);
    }
    case 'speed':
      return speedPhrase(cmd.value ?? 0, lang);
    case 'resume_speed':
      return ph(en ? 'normal speed' : 'velocidad normal');
    case 'direct':
      return ph(`${en ? 'direct' : 'directo'} ${cmd.fix ?? ''}`);
    case 'ils': {
      const r = runwayPhrase(cmd.runway ?? airport.arrivalRunway, lang);
      return en
        ? ph(`cleared ILS approach ${r.text}`, `cleared I L S approach ${r.spoken}`)
        : ph(`autorizado aproximación ILS ${r.text}`, `autorizado aproximación I L S ${r.spoken}`);
    }
    case 'contact': {
      const tower = cmd.facility !== 'center';
      const name = tower ? airport.towerName[lang] : airport.centerName[lang];
      const f = freqPhrase(tower ? airport.towerFreq : airport.centerFreq, lang);
      return ph(`${en ? 'contact' : 'con'} ${name} ${f.text}`, `${en ? 'contact' : 'con'} ${name} ${f.spoken}`);
    }
    case 'go_around':
      return ph(en ? 'going around' : 'motor y al aire');
  }
}

/** Pilot-initiated calls and stock answers. `cs` is the callsign phrase. */
export const pilot = {
  checkInArrival(cs: Phrase, lang: Lang, airport: Airport, alt: number, target: number, toFix: string): Phrase {
    const a = altitudePhrase(alt, lang, airport.transitionAltitude);
    const t = altitudePhrase(target, lang, airport.transitionAltitude);
    const level = Math.abs(alt - target) < 200;
    if (lang === 'en') {
      const vert = level ? ph(`maintaining ${a.text}`, `maintaining ${a.spoken}`) : ph(`${a.text} descending ${t.text}`, `${a.spoken} descending ${t.spoken}`);
      return join([ph(airport.approachName.en), cs, vert, ph(`inbound ${toFix}`)]);
    }
    const vert = level ? ph(`manteniendo ${a.text}`, `manteniendo ${a.spoken}`) : ph(`${a.text} en descenso para ${t.text}`, `${a.spoken} en descenso para ${t.spoken}`);
    return join([ph(`${airport.approachName.es}, buenas`), cs, vert, ph(`hacia ${toFix}`)]);
  },
  checkInDeparture(cs: Phrase, lang: Lang, airport: Airport, alt: number, target: number): Phrase {
    const a = altitudePhrase(Math.round(alt / 100) * 100, lang, airport.transitionAltitude);
    const t = altitudePhrase(target, lang, airport.transitionAltitude);
    return lang === 'en'
      ? join([ph(airport.approachName.en), cs, ph(`passing ${a.text} climbing ${t.text}`, `passing ${a.spoken} climbing ${t.spoken}`)])
      : join([ph(airport.approachName.es), cs, ph(`pasando ${a.text} en ascenso para ${t.text}`, `pasando ${a.spoken} en ascenso para ${t.spoken}`)]);
  },
  established(cs: Phrase, lang: Lang, runway: string): Phrase {
    const r = runwayPhrase(runway, lang);
    return lang === 'en'
      ? join([cs, ph(`established ILS ${r.text}`, `established I L S ${r.spoken}`)])
      : join([cs, ph(`establecido ILS ${r.text}`, `establecido I L S ${r.spoken}`)]);
  },
  finalReminder(cs: Phrase, lang: Lang, runway: string, miles: number): Phrase {
    const r = runwayPhrase(runway, lang);
    return lang === 'en'
      ? join([cs, ph(`${miles} mile final ${r.text}, still with you`, `${digits(miles, 'en')} mile final ${r.spoken}, still with you`)])
      : join([cs, ph(`en final a ${miles} millas ${r.text}, seguimos con usted`, `en final a ${digits(miles, 'es')} millas ${r.spoken}, seguimos con usted`)]);
  },
  sayAgain(cs: Phrase, lang: Lang): Phrase {
    return lang === 'en' ? join([ph('say again'), cs]) : join([ph('repita'), cs]);
  },
  unable(cs: Phrase, lang: Lang, reason: Phrase): Phrase {
    return lang === 'en' ? join([ph('unable'), reason, cs]) : join([ph('imposible'), reason, cs]);
  },
  roger(cs: Phrase, lang: Lang): Phrase {
    return lang === 'en' ? join([ph('roger'), cs]) : join([ph('recibido'), cs]);
  },
  goingAround(cs: Phrase, lang: Lang, reason: Phrase | null): Phrase {
    return lang === 'en' ? join([cs, ph('going around'), reason]) : join([cs, ph('motor y al aire'), reason]);
  },
  requestDescent(cs: Phrase, lang: Lang): Phrase {
    return lang === 'en' ? join([cs, ph('request descent')]) : join([cs, ph('solicita descenso')]);
  },
  requestClimb(cs: Phrase, lang: Lang): Phrase {
    return lang === 'en' ? join([cs, ph('request higher')]) : join([cs, ph('solicita ascenso')]);
  },
  emergency(cs: Phrase, lang: Lang, kind: EmergencyKind): Phrase {
    const prefix = kind === 'medical' ? 'PAN PAN, PAN PAN, PAN PAN' : 'MAYDAY MAYDAY MAYDAY';
    const bodies: Record<Lang, Record<EmergencyKind, string>> = {
      en: {
        engine: 'engine failure, request immediate vectors for the ILS',
        medical: 'medical emergency on board, request priority landing',
        fuel: 'MAYDAY fuel, request direct to final',
      },
      es: {
        engine: 'fallo de motor, solicita vectores inmediatos para el ILS',
        medical: 'emergencia médica a bordo, solicita prioridad para aterrizar',
        fuel: 'MAYDAY combustible, solicita directo a final',
      },
    };
    const body = bodies[lang][kind];
    return join([ph(prefix), cs, ph(body, body.replace(/ILS/g, 'I L S'))]);
  },
  leavingAirspace(cs: Phrase, lang: Lang): Phrase {
    return lang === 'en' ? join([cs, ph('leaving your airspace, switching to en-route frequency')]) : join([cs, ph('abandonando su espacio aéreo, cambiamos a ruta')]);
  },
  sayValue(cs: Phrase, value: Phrase): Phrase {
    return join([value, cs]);
  },
  radioCheck(cs: Phrase, lang: Lang): Phrase {
    return lang === 'en' ? join([ph('read you five'), cs]) : join([ph('le recibo cinco'), cs]);
  },
};

export type EmergencyKind = 'engine' | 'medical' | 'fuel';

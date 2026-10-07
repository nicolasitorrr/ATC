import type { Command, Interpretation, InterpretContext, QueryType } from '../../shared/types';

// Rule-based interpreter for controller transmissions. It understands typed
// shorthand ("VLG1234 h 250 a 5000 s 210") and standard English/Spanish
// phraseology. Used when Claude is unavailable, and always for shorthand.

export interface LocalInterpretation extends Interpretation {
  shorthand: boolean;
}

const WORD_NUMBERS: Record<string, string> = {
  zero: '0', oh: '0', one: '1', two: '2', three: '3', tree: '3', four: '4', five: '5', fife: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
  cero: '0', uno: '1', dos: '2', tres: '3', cuatro: '4', cinco: '5', seis: '6', siete: '7', ocho: '8', nueve: '9',
  cien: '100', doscientos: '200', trescientos: '300', cuatrocientos: '400', quinientos: '500', seiscientos: '600', setecientos: '700', ochocientos: '800', novecientos: '900',
};

const strip = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Lowercase, drop accents and punctuation, and turn spoken numbers into digits. */
export function normalize(text: string): string {
  let s = strip(text)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => WORD_NUMBERS[t] ?? t)
    .join(' ');
  s = s.replace(/\b\d(?: \d\b)+/g, (m) => m.replace(/ /g, '')); // "2 5 0" -> "250"
  s = s.replace(/\b(\d+) (?:thousand|mil) (\d) hundred\b/g, (_, t, h) => String(+t * 1000 + +h * 100));
  s = s.replace(/\b(\d+) (?:thousand|mil) (\d00)\b/g, (_, t, h) => String(+t * 1000 + +h));
  s = s.replace(/\b(\d+) (?:thousand|mil)\b/g, (_, t) => String(+t * 1000));
  s = s.replace(/\bmil (\d00)\b/g, (_, h) => String(1000 + +h));
  s = s.replace(/\bmil\b/g, '1000');
  return s;
}

const SIDE: Record<string, string> = { left: 'L', izquierda: 'L', l: 'L', right: 'R', derecha: 'R', r: 'R', center: 'C', centre: 'C', centro: 'C', c: 'C' };
const TURN: Record<string, 'left' | 'right'> = { left: 'left', izquierda: 'left', right: 'right', derecha: 'right' };

export function parseTransmission(text: string, ctx: InterpretContext): LocalInterpretation {
  return parseShorthand(text, ctx) ?? parsePhraseology(text, ctx);
}

function result(callsign: string | null, commands: Command[], query: QueryType | null, reply: string | null, shorthand: boolean): LocalInterpretation {
  return { callsign, commands, query, reply, understood: commands.length > 0 || !!query || !!reply, source: 'local', shorthand };
}

const toAltitude = (n: number) => (n < 1000 ? n * 100 : n);

function parseShorthand(text: string, ctx: InterpretContext): LocalInterpretation | null {
  const tokens = strip(text).trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  let callsign: string | null = null;
  if (/^[a-z]{2,3}\d{1,4}$/.test(tokens[0])) callsign = tokens.shift()!.toUpperCase();

  const commands: Command[] = [];
  let i = 0;
  const num = () => (/^\d+$/.test(tokens[i] ?? '') ? +tokens[i++] : null);
  while (i < tokens.length) {
    const t = tokens[i++];
    const fl = /^fl(\d{2,3})$/.exec(t);
    if (fl) {
      commands.push({ type: 'altitude', value: +fl[1] * 100 });
      continue;
    }
    switch (t) {
      case 'h':
      case 'hdg':
      case 'l':
      case 'r': {
        const v = num();
        if (v == null) return null;
        commands.push({ type: 'heading', value: v, turn: t === 'l' ? 'left' : t === 'r' ? 'right' : null });
        break;
      }
      case 'a':
      case 'alt':
      case 'fl': {
        const v = num();
        if (v == null) return null;
        commands.push({ type: 'altitude', value: t === 'fl' ? v * 100 : toAltitude(v) });
        break;
      }
      case 's':
      case 'spd': {
        const v = num();
        if (v == null) return null;
        commands.push({ type: 'speed', value: v });
        break;
      }
      case 'd':
      case 'dct': {
        const fix = tokens[i++];
        if (!fix) return null;
        commands.push({ type: 'direct', fix: fix.toUpperCase() });
        break;
      }
      case 'ils': {
        const next = tokens[i] ?? '';
        const runway = /^\d{2}[lrc]?$/.test(next) ? tokens[i++].toUpperCase() : null;
        commands.push({ type: 'ils', runway });
        break;
      }
      case 'twr':
        commands.push({ type: 'contact', facility: 'tower' });
        break;
      case 'ctr':
        commands.push({ type: 'contact', facility: 'center' });
        break;
      case 'ga':
        commands.push({ type: 'go_around' });
        break;
      case 'ns':
        commands.push({ type: 'resume_speed' });
        break;
      case 'ph':
        commands.push({ type: 'present_heading' });
        break;
      default:
        return null; // not shorthand after all
    }
  }
  if (!commands.length) return null;
  return result(callsign ?? ctx.selected, commands, null, null, true);
}

/** Find which aircraft is addressed and return the text with its callsign removed. */
function findCallsign(s: string, ctx: InterpretContext): { callsign: string | null; rest: string } {
  for (const a of ctx.aircraft) {
    const icao = a.callsign.replace(/\d+$/, '').toLowerCase();
    const spaced = a.callsign.replace(/^[A-Z]+/, '').split('').join(' ?');
    const names = [strip(a.telephony).replace(/[^a-z0-9 ]/g, ''), icao, icao.split('').join(' ')];
    const m = new RegExp(`\\b(?:${names.join('|')}) ?${spaced}(?!\\d)`).exec(s);
    if (m) return { callsign: a.callsign, rest: (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)).trim() };
  }
  // airline name alone, when only one of its aircraft is on frequency
  const byName = ctx.aircraft.filter((a) => new RegExp(`\\b${strip(a.telephony)}\\b`).test(s));
  if (byName.length === 1) return { callsign: byName[0].callsign, rest: s.replace(new RegExp(`\\b${strip(byName[0].telephony)}\\b( \\d+)?`), ' ').trim() };
  // flight number alone
  const byNumber = ctx.aircraft.filter((a) => new RegExp(`^${a.callsign.replace(/^[A-Z]+/, '')}\\b`).test(s));
  if (byNumber.length === 1) return { callsign: byNumber[0].callsign, rest: s.replace(/^\d+/, '').trim() };
  return { callsign: null, rest: s };
}

function parsePhraseology(text: string, ctx: InterpretContext): LocalInterpretation {
  const found = findCallsign(normalize(text), ctx);
  const s = found.rest;
  const callsign = found.callsign ?? ctx.selected;
  const commands: Command[] = [];

  const query: QueryType | null =
    /\bradio check\b|prueba de radio/.test(s) ? 'radio_check'
    : /\b(?:say|confirm|report|diga|confirme|notifique)\b.{0,12}\b(?:altitude|level|altitud|nivel)\b/.test(s) ? 'say_altitude'
    : /\b(?:say|confirm|report|diga|confirme|notifique)\b.{0,12}\b(?:heading|rumbo)\b/.test(s) ? 'say_heading'
    : /\b(?:say|confirm|report|diga|confirme|notifique)\b.{0,12}\b(?:speed|velocidad)\b/.test(s) ? 'say_speed'
    : null;
  if (query) return result(callsign, [], query, null, false);

  const expect = /\b(?:expect|espere|prevea)\b/.test(s);

  // heading
  const hdg = /\b(?:heading|rumbo|hdg) ?(\d{1,3})\b/.exec(s);
  if (hdg) {
    const turn = /\b(?:turn|vire|viraje|virar|gire)(?: a la| por la| por)? (left|right|izquierda|derecha)\b/.exec(s) ?? /\b(left|right|izquierda|derecha) (?:heading|rumbo)\b/.exec(s);
    commands.push({ type: 'heading', value: +hdg[1], turn: turn ? TURN[turn[1]] : null });
  } else if (/present heading|rumbo actual/.test(s)) commands.push({ type: 'present_heading' });

  // altitude
  const alt =
    /\b(?:climb|descend|maintain|altitude|ascienda|ascenso|suba|descienda|descenso|baje|mantenga|mantener|altitud)\b (?:(?!speed|heading|velocidad|rumbo|direct|fl\b|flight|nivel)[a-z]+ ){0,4}?(fl|flight level|nivel de vuelo|nivel)? ?(\d{2,5})\b/.exec(s) ??
    /\b(fl|flight level|nivel de vuelo|nivel) ?(\d{2,3})\b/.exec(s);
  if (alt) commands.push({ type: 'altitude', value: alt[1] ? +alt[2] * 100 : toAltitude(+alt[2]) });

  // speed
  if (/no speed restriction|normal speed|resume (?:normal )?speed|sin restriccion(?:es)? de velocidad|velocidad normal|velocidad libre/.test(s)) commands.push({ type: 'resume_speed' });
  else {
    const spd =
      /\b(?:speed|velocidad)(?: (?:to|a|of|de))? (\d{3})\b/.exec(s) ??
      /\b(?:reduce|reduzca|reducir|increase|aumente|incremente)(?: (?:to|a|speed|velocidad))* (\d{3})\b/.exec(s) ??
      /\b(\d{3}) ?(?:knots|nudos|kts)\b/.exec(s);
    if (spd) commands.push({ type: 'speed', value: +spd[1] });
  }

  // direct
  const dct = /\b(?:direct|directo|proceed|proceda)(?: (?:direct|directo))?(?: (?:to|a|al))? ([a-z]{2,5})\b/.exec(s);
  if (dct) commands.push({ type: 'direct', fix: dct[1].toUpperCase() });

  // approach clearance
  if (!expect && /\b(?:ils|approach|aproximacion)\b/.test(s)) {
    const rwy = /\b(?:runway|pista) ?(\d{2}) ?(left|right|center|centre|izquierda|derecha|centro|l|r|c)?\b/.exec(s);
    commands.push({ type: 'ils', runway: rwy ? rwy[1] + (rwy[2] ? SIDE[rwy[2]] : '') : null });
  }

  // handoff
  if (/\b(?:tower|torre)\b/.test(s)) commands.push({ type: 'contact', facility: 'tower' });
  else if (/\b(?:contact|contacte|llame|comunique|pase|con)\b.{0,20}\b(?:control|center|centre|centro|radar)\b/.test(s)) commands.push({ type: 'contact', facility: 'center' });

  if (/go around|motor y al aire|frustrada|frustre/.test(s)) commands.push({ type: 'go_around' });

  if (!commands.length && expect) return result(callsign, [], null, /espere|prevea/.test(s) ? 'Recibido' : 'Roger', false);
  return result(callsign, commands, null, null, false);
}

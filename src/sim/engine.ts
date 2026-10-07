import type { Command, Interpretation, InterpretContext, Lang } from '../../shared/types';
import { type Airport, type Fix, type Runway, findFix, findRunway } from './airports';
import type { SimParams } from './difficulty';
import { AIRLINES, type Perf, TYPES, type Wake } from './fleet';
import { DEG, angleDiff, bearing, clamp, dist, mulberry32, norm360, project } from './geo';
import { type EmergencyKind, type Phrase, altitudePhrase, callsignPhrase, commandPhrase, headingPhrase, join, ph, pilot, speedPhrase } from './phraseology';

export interface Aircraft {
  id: number;
  callsign: string;
  telephony: string;
  type: string;
  perf: Perf;
  lang: Lang;
  /** seed used to pick this pilot's voice */
  voice: number;
  kind: 'arrival' | 'departure';
  x: number;
  y: number;
  alt: number;
  hdg: number;
  ias: number;
  gs: number;
  track: number;
  tgtAlt: number;
  tgtHdg: number;
  tgtSpd: number;
  speedAssigned: boolean;
  turn: 'left' | 'right' | null;
  nav: 'heading' | 'direct' | 'loc';
  directFix: Fix | null;
  /** runway of the approach clearance, if any */
  ilsRunway: Runway | null;
  established: boolean;
  onGlide: boolean;
  /** distance to the threshold along the final course while established */
  finalDist: number | null;
  /** pending: not yet on frequency. tower/center: handed off. */
  status: 'pending' | 'active' | 'tower' | 'center';
  entryFix: string | null;
  exitFix: string | null;
  emergency: EmergencyKind | null;
  history: { x: number; y: number }[];
  conflict: boolean;
  warning: boolean;
  done: 'landed' | 'left' | null;
  spawnTime: number;
  lastInstruction: number;
  lastRequest: number;
  lastError: number;
  checkInAlt: number;
  checkInScheduled: boolean;
  reminded: boolean;
  historyTimer: number;
}

export interface Transmission {
  id: number;
  time: number;
  from: 'pilot' | 'atc' | 'system';
  callsign: string | null;
  text: string;
  spoken: string;
  lang: Lang;
  voice: number;
}

export interface Stats {
  landed: number;
  departed: number;
  incidents: number;
  goArounds: number;
  busts: number;
}

const GLIDE_FT_PER_NM = 318.4; // 3 degree glidepath
const TURN_RATE = 3; // degrees per second
const MAX_CLEARED_ALT = 24000;
const WAKE_MINIMA: Record<Wake, Record<Wake, number>> = {
  // leader -> follower
  H: { H: 4, M: 5, L: 6 },
  M: { H: 0, M: 0, L: 5 },
  L: { H: 0, M: 0, L: 0 },
};

export class Sim {
  time = 0;
  aircraft: Aircraft[] = [];
  score = 0;
  stats: Stats = { landed: 0, departed: 0, incidents: 0, goArounds: 0, busts: 0 };
  onTransmission: (t: Transmission) => void = () => {};

  private rng: () => number;
  private nextId = 1;
  private nextTx = 1;
  private pending: { at: number; run: () => void }[] = [];
  private conflicts = new Set<string>();
  private nextArrival: number;
  private nextDeparture: number;
  private lastDeparture = -1e9;
  private requestTimer = 0;

  constructor(
    readonly airport: Airport,
    readonly params: SimParams,
    seed: number = Date.now(),
  ) {
    this.rng = mulberry32(seed);
    for (let i = 0; i < params.initialTraffic; i++) {
      const lap = Math.floor(i / airport.entries.length);
      this.spawnArrival(i % airport.entries.length, 3 + lap * 10 + this.rng() * 4);
    }
    this.nextArrival = params.initialTraffic > 0 ? this.interval(params.arrivalsPerHour) : 5;
    this.nextDeparture = 20 + this.interval(params.departuresPerHour) * 0.5;
  }

  /** Advance the simulation by `dt` seconds of simulated time. */
  advance(dt: number): void {
    let left = dt;
    while (left > 1e-6) {
      const step = Math.min(1, left);
      this.update(step);
      left -= step;
    }
  }

  // ---- controller input -------------------------------------------------

  /** Feed an interpreted controller transmission to the addressed pilot. */
  handleController(interp: Interpretation, selected: string | null): Aircraft | null {
    const a = this.findByCallsign(interp.callsign) ?? this.findByCallsign(selected);
    if (!a) {
      this.system(`Nadie responde${interp.callsign ? ` (${interp.callsign})` : ''}: indicativo no reconocido.`);
      return null;
    }
    if (a.status === 'tower' || a.status === 'center') {
      this.system(`${a.callsign} ya no está en tu frecuencia.`);
      return a;
    }
    a.status = 'active';
    a.lastInstruction = this.time;
    const cs = this.cs(a);
    const [lo, hi] = this.params.responseDelay;
    const delay = lo + (hi - lo) * this.rng();

    const empty = interp.commands.length === 0 && !interp.query && !interp.reply;
    if (!interp.understood || empty || this.rng() < this.params.sayAgainRate) {
      this.say(a, pilot.sayAgain(cs, a.lang), delay);
      return a;
    }
    if (interp.commands.length === 0) {
      if (interp.query) this.say(a, this.answer(a, interp.query), delay);
      else if (interp.reply) this.say(a, ph(interp.reply), delay);
      return a;
    }
    const commands = interp.commands;
    this.schedule(delay, () => this.execute(a, commands));
    return a;
  }

  /** The controller's instruction in standard phraseology, for the comms log. */
  controllerPhrase(a: Aircraft, commands: Command[]): Phrase {
    const env = { lang: a.lang, airport: this.airport, altitude: a.alt };
    return join([this.cs(a), ...commands.map((c) => commandPhrase(c, env))]);
  }

  context(selected: string | null): InterpretContext {
    const ap = this.airport;
    return {
      airport: ap.icao,
      approachName: ap.approachName.en,
      transitionAltitude: ap.transitionAltitude,
      arrivalRunway: ap.arrivalRunway,
      departureRunway: ap.departureRunway,
      fixes: ap.fixes.map((f) => f.name),
      aircraft: this.aircraft
        .filter((a) => a.status === 'active' || a.status === 'pending')
        .map((a) => ({
          callsign: a.callsign,
          telephony: a.telephony,
          kind: a.kind,
          altitude: Math.round(a.alt / 100) * 100,
          heading: Math.round(a.hdg),
          speed: Math.round(a.ias),
          lang: a.lang,
        })),
      selected,
    };
  }

  findByCallsign(callsign: string | null | undefined): Aircraft | null {
    if (!callsign) return null;
    const c = callsign.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const exact = this.aircraft.find((a) => a.callsign === c);
    if (exact) return exact;
    const num = c.replace(/^[A-Z]+/, '');
    if (!num) return null;
    const byNumber = this.aircraft.filter((a) => a.callsign.replace(/^[A-Z]+/, '') === num);
    return byNumber.length === 1 ? byNumber[0] : null;
  }

  // ---- instructions -----------------------------------------------------

  private execute(a: Aircraft, commands: Command[]): void {
    if (a.done) return;
    const en = a.lang === 'en';
    let accepted: Command[] = [];
    const problems: Phrase[] = [];
    for (const raw of commands) {
      const r = this.validate(a, raw, accepted);
      if ('error' in r) problems.push(r.error);
      else accepted.push(r.cmd);
    }
    if (accepted.length && this.time - a.lastError > 90 && this.rng() < this.params.pilotErrorRate) {
      accepted = this.mishear(a, accepted);
    }
    const env = { lang: a.lang, airport: this.airport, altitude: a.alt };
    const parts = accepted.map((c) => commandPhrase(c, env));
    for (const c of accepted) this.apply(a, c);
    for (const p of problems) parts.push(join([ph(en ? 'unable' : 'imposible'), p], ' '));
    this.transmit(a, join([...parts, this.cs(a)]));
  }

  /** `earlier` holds the instructions already accepted from the same transmission. */
  private validate(a: Aircraft, cmd: Command, earlier: Command[]): { cmd: Command } | { error: Phrase } {
    const ap = this.airport;
    const en = a.lang === 'en';
    const err = (enText: string, esText: string) => ({ error: ph(en ? enText : esText) });
    switch (cmd.type) {
      case 'heading': {
        if (cmd.value == null || cmd.value < 0 || cmd.value > 360) return err('say again heading', 'repita rumbo');
        return { cmd: { ...cmd, value: Math.round(cmd.value) % 360 || 360 } };
      }
      case 'altitude': {
        if (cmd.value == null || cmd.value <= 0) return err('say again altitude', 'repita altitud');
        // flight levels may arrive as 120 instead of 12000
        const v = Math.round((cmd.value < 1000 ? cmd.value * 100 : cmd.value) / 100) * 100;
        if (v < ap.minVectoringAltitude) return err(`minimum altitude is ${ap.minVectoringAltitude} feet`, `la altitud mínima es ${ap.minVectoringAltitude} pies`);
        if (v > MAX_CLEARED_ALT) return err('that level is above your airspace', 'ese nivel está por encima de su espacio aéreo');
        return { cmd: { ...cmd, value: v } };
      }
      case 'speed': {
        if (cmd.value == null || cmd.value <= 0) return err('say again speed', 'repita velocidad');
        const v = Math.round(cmd.value);
        const nearField = a.kind === 'arrival' && Math.hypot(a.x, a.y) < 25;
        const min = nearField ? a.perf.vapp + 15 : a.perf.minClean;
        if (v < min) return err(`minimum speed ${min} knots`, `velocidad mínima ${min} nudos`);
        if (a.alt < 10000 && v > 250) return err('maximum 250 knots below flight level 100', 'máximo 250 nudos por debajo de nivel 100');
        return { cmd: { ...cmd, value: Math.min(v, a.perf.cruise + 20) } };
      }
      case 'direct': {
        const fix = cmd.fix ? findFix(ap, cmd.fix) : undefined;
        if (!fix) return err('say again the fix', 'repita el punto');
        return { cmd: { ...cmd, fix: fix.name } };
      }
      case 'ils': {
        if (a.kind !== 'arrival') return err('we are a departure', 'somos una salida');
        const wanted = (cmd.runway ?? ap.arrivalRunway).toUpperCase().replace(/\s/g, '');
        const id = ap.arrivalRunway.startsWith(wanted) ? ap.arrivalRunway : wanted;
        if (id !== ap.arrivalRunway || !findRunway(ap, id)) return err(`runway ${wanted} is not in use for landing`, `la pista ${wanted} no está en uso para aterrizajes`);
        return { cmd: { ...cmd, runway: id } };
      }
      case 'contact': {
        const facility = cmd.facility ?? (a.kind === 'arrival' ? 'tower' : 'center');
        if (a.kind === 'arrival' && facility === 'center') return err('we are inbound', 'somos una llegada');
        if (a.kind === 'departure' && facility === 'tower') return err('we are a departure', 'somos una salida');
        if (facility === 'tower' && !a.ilsRunway && !earlier.some((c) => c.type === 'ils')) return err('not cleared for the approach', 'no estamos autorizados a la aproximación');
        return { cmd: { ...cmd, facility } };
      }
      case 'go_around':
        if (!a.ilsRunway) return err('not on approach', 'no estamos en aproximación');
        return { cmd };
      case 'present_heading':
      case 'resume_speed':
        return { cmd };
    }
  }

  /** A pilot error: one value is misheard, read back wrong and flown wrong. */
  private mishear(a: Aircraft, cmds: Command[]): Command[] {
    const candidates = cmds.map((c, i) => (c.type === 'heading' || c.type === 'altitude' || c.type === 'speed' ? i : -1)).filter((i) => i >= 0);
    if (!candidates.length) return cmds;
    const i = candidates[Math.floor(this.rng() * candidates.length)];
    const c = { ...cmds[i] };
    const sign = this.rng() < 0.5 ? -1 : 1;
    const v = c.value ?? 0;
    if (c.type === 'heading') c.value = norm360(v + sign * (this.rng() < 0.5 ? 10 : 20)) || 360;
    else if (c.type === 'altitude') {
      c.value = clamp(v + sign * 1000, this.airport.minVectoringAltitude, MAX_CLEARED_ALT);
      if (c.value === v) c.value = v + 1000;
    } else c.value = Math.max(v + sign * 20, a.perf.vapp + 15);
    a.lastError = this.time;
    const out = cmds.slice();
    out[i] = c;
    return out;
  }

  private apply(a: Aircraft, cmd: Command): void {
    const ap = this.airport;
    switch (cmd.type) {
      case 'heading':
      case 'present_heading':
        if (a.established) this.cancelApproach(a);
        a.nav = 'heading';
        a.directFix = null;
        a.tgtHdg = cmd.type === 'heading' ? cmd.value! : Math.round(a.hdg) || 360;
        a.turn = cmd.type === 'heading' ? (cmd.turn ?? null) : null;
        break;
      case 'altitude':
        if (a.onGlide) this.cancelApproach(a);
        a.tgtAlt = cmd.value!;
        break;
      case 'speed':
        a.tgtSpd = cmd.value!;
        a.speedAssigned = true;
        break;
      case 'resume_speed':
        a.speedAssigned = false;
        break;
      case 'direct':
        if (a.established) this.cancelApproach(a);
        a.nav = 'direct';
        a.directFix = findFix(ap, cmd.fix!)!;
        a.turn = null;
        break;
      case 'ils':
        a.ilsRunway = findRunway(ap, cmd.runway!)!;
        break;
      case 'contact':
        if (cmd.facility === 'tower') a.status = 'tower';
        else this.handoffToCenter(a);
        break;
      case 'go_around':
        this.goAround(a, null, false);
        break;
    }
  }

  private handoffToCenter(a: Aircraft): void {
    const exit = a.exitFix ? findFix(this.airport, a.exitFix) : undefined;
    const toExit = exit ? Math.abs(angleDiff(a.track, bearing(a.x, a.y, exit.x, exit.y))) < 30 : true;
    const onRoute = (a.nav === 'direct' && a.directFix?.name === a.exitFix) || toExit;
    const good = onRoute && a.tgtAlt >= this.airport.handoffAltitude;
    this.score += good ? 60 : 20;
    this.stats.departed++;
    this.system(
      good
        ? `${a.callsign} transferido a control. +60`
        : `${a.callsign} transferido a control sin ruta a ${a.exitFix} o por debajo de ${altitudePhrase(this.airport.handoffAltitude, 'en', this.airport.transitionAltitude).text}. +20`,
    );
    a.status = 'center';
    a.tgtAlt = MAX_CLEARED_ALT;
    a.speedAssigned = false;
    if (exit) {
      a.nav = 'direct';
      a.directFix = exit;
      a.turn = null;
    }
  }

  private cancelApproach(a: Aircraft): void {
    a.ilsRunway = null;
    a.established = false;
    a.onGlide = false;
    a.finalDist = null;
    a.reminded = false;
    if (a.nav === 'loc') a.nav = 'heading';
  }

  private goAround(a: Aircraft, reason: Phrase | null, penalise: boolean): void {
    const rwy = a.ilsRunway;
    this.cancelApproach(a);
    a.nav = 'heading';
    a.tgtHdg = rwy?.heading ?? (Math.round(a.hdg) || 360);
    a.turn = null;
    a.tgtAlt = this.airport.missedApproachAltitude;
    a.tgtSpd = 210;
    a.speedAssigned = false;
    a.status = 'active';
    this.stats.goArounds++;
    if (penalise) this.score -= 40;
    this.say(a, pilot.goingAround(this.cs(a), a.lang, reason), 1);
  }

  private answer(a: Aircraft, query: NonNullable<Interpretation['query']>): Phrase {
    const cs = this.cs(a);
    switch (query) {
      case 'say_altitude':
        return pilot.sayValue(cs, altitudePhrase(a.alt, a.lang, this.airport.transitionAltitude));
      case 'say_heading':
        return pilot.sayValue(cs, headingPhrase(a.hdg, a.lang));
      case 'say_speed':
        return pilot.sayValue(cs, speedPhrase(a.ias, a.lang));
      case 'radio_check':
        return pilot.radioCheck(cs, a.lang);
    }
  }

  // ---- simulation step --------------------------------------------------

  private update(dt: number): void {
    this.time += dt;

    const due = this.pending.filter((p) => p.at <= this.time);
    if (due.length) {
      this.pending = this.pending.filter((p) => p.at > this.time);
      for (const p of due) p.run();
    }

    this.spawnTraffic();
    for (const a of this.aircraft) this.step(a, dt);
    this.aircraft = this.aircraft.filter((a) => !a.done);
    this.detectConflicts(dt);

    this.requestTimer += dt;
    if (this.requestTimer >= 15) {
      this.requestTimer = 0;
      this.pilotRequests();
    }
  }

  private step(a: Aircraft, dt: number): void {
    const ap = this.airport;
    const tas = a.ias * (1 + a.alt * 0.000017);

    if (a.nav === 'direct' && a.directFix) {
      a.tgtHdg = this.headingForTrack(bearing(a.x, a.y, a.directFix.x, a.directFix.y), tas);
      if (dist(a.x, a.y, a.directFix.x, a.directFix.y) < 0.7) {
        a.nav = 'heading';
        a.directFix = null;
        a.tgtHdg = Math.round(a.hdg) || 360;
      }
    }
    if (a.ilsRunway) this.stepIls(a, tas, dt);
    if (a.done) return;

    // heading
    let diff = angleDiff(a.hdg, a.tgtHdg);
    if (Math.abs(diff) <= 2) a.turn = null;
    else if (a.turn === 'left' && diff > 0) diff -= 360;
    else if (a.turn === 'right' && diff < 0) diff += 360;
    a.hdg = norm360(a.hdg + clamp(diff, -TURN_RATE * dt, TURN_RATE * dt));

    // speed
    let want = a.speedAssigned ? a.tgtSpd : Math.min(a.perf.cruise, a.kind === 'departure' ? 290 : 270);
    if (a.alt < 10000) want = Math.min(want, 250);
    if (a.finalDist != null) {
      if (a.finalDist < 12) want = Math.min(want, 180);
      if (a.finalDist < 6) want = Math.min(want, 160);
      if (a.finalDist < 4) want = a.perf.vapp;
    }
    if (!a.speedAssigned) a.tgtSpd = want;
    a.ias += clamp(want - a.ias, -1.2 * dt, 1.8 * dt);

    // altitude (the glideslope is handled in stepIls)
    if (!a.onGlide) {
      const d = a.tgtAlt - a.alt;
      const rate = d > 0 ? a.perf.climb * (1 - a.alt / 60000) : a.perf.descent;
      a.alt += clamp(d, (-rate * dt) / 60, (rate * dt) / 60);
    }

    // movement, with wind drift
    const w = this.windVector();
    const vx = tas * Math.sin(a.hdg * DEG) + w.x;
    const vy = tas * Math.cos(a.hdg * DEG) + w.y;
    a.gs = Math.hypot(vx, vy);
    a.track = norm360(Math.atan2(vx, vy) / DEG);
    a.x += (vx * dt) / 3600;
    a.y += (vy * dt) / 3600;

    a.historyTimer += dt;
    if (a.historyTimer >= 6) {
      a.historyTimer = 0;
      a.history.push({ x: a.x, y: a.y });
      if (a.history.length > 7) a.history.shift();
    }

    // departures call us once airborne and climbing
    if (a.kind === 'departure' && a.status === 'pending' && !a.checkInScheduled && a.alt >= a.checkInAlt) {
      a.checkInScheduled = true;
      this.schedule(1 + this.rng() * 3, () => {
        if (a.done || a.status !== 'pending') return;
        a.status = 'active';
        a.lastInstruction = this.time;
        this.transmit(a, pilot.checkInDeparture(this.cs(a), a.lang, ap, a.alt, a.tgtAlt));
      });
    }

    if (Math.hypot(a.x, a.y) > ap.radiusNm + 2) this.leaveAirspace(a);
  }

  private stepIls(a: Aircraft, tas: number, dt: number): void {
    const ap = this.airport;
    const r = a.ilsRunway!;
    const c = r.heading * DEG;
    const dx = a.x - r.thrX;
    const dy = a.y - r.thrY;
    const d = -(dx * Math.sin(c) + dy * Math.cos(c)); // distance to run before the threshold
    const xte = dx * Math.cos(c) - dy * Math.sin(c); // positive = right of the final course

    if (!a.established) {
      const angle = Math.abs(angleDiff(a.track, r.heading));
      const radius = a.gs / 3600 / (TURN_RATE * DEG);
      const lead = radius * Math.tan((Math.min(angle, 90) / 2) * DEG) + 0.15;
      if (d < 1 || d > 30 || angle > 95 || Math.abs(xte) > lead) return;
      a.established = true;
      a.nav = 'loc';
      a.directFix = null;
      a.turn = null;
      if (angle > 45) {
        this.score -= 10;
        this.system(`${a.callsign}: interceptación del localizador con ${Math.round(angle)}° (máx. recomendado 30°). -10`);
      }
      if (a.status === 'active') this.say(a, pilot.established(this.cs(a), a.lang, r.id), 2);
    }

    a.finalDist = d;
    a.tgtHdg = this.headingForTrack(norm360(r.heading + clamp(-xte * 25, -30, 30)), tas);

    const gsAlt = ap.elevation + Math.max(0, d) * GLIDE_FT_PER_NM;
    if (!a.onGlide && a.alt >= gsAlt - 50) a.onGlide = true;
    if (a.onGlide) {
      a.tgtAlt = ap.elevation;
      if (a.alt > gsAlt) a.alt = Math.max(gsAlt, a.alt - 30 * dt); // at most 1800 fpm
      if (a.alt > gsAlt + 500 && d < 4) {
        this.goAround(a, ph(a.lang === 'en' ? 'unstable approach' : 'aproximación no estabilizada'), true);
        return;
      }
    }

    if (a.status !== 'tower') {
      if (d < 6 && !a.reminded) {
        a.reminded = true;
        this.say(a, pilot.finalReminder(this.cs(a), a.lang, r.id, Math.max(2, Math.round(d))), 0);
      }
      if (d < 1.5) {
        this.goAround(a, ph(a.lang === 'en' ? 'no landing clearance' : 'sin autorización para aterrizar'), true);
        this.system(`${a.callsign} frustró: no fue transferido a torre a tiempo. -40`);
      }
      return;
    }
    if (d < 0.1) {
      a.done = 'landed';
      const points = a.emergency ? 250 : 100;
      this.score += points;
      this.stats.landed++;
      this.system(`${a.callsign} aterrizó en la pista ${r.id}. +${points}`);
    }
  }

  private leaveAirspace(a: Aircraft): void {
    a.done = 'left';
    if (a.status === 'center' || a.status === 'tower') return;
    this.score -= 50;
    this.stats.busts++;
    if (a.status === 'active') this.transmit(a, pilot.leavingAirspace(this.cs(a), a.lang));
    this.system(`${a.callsign} salió de tu espacio aéreo sin transferencia. -50`);
  }

  private detectConflicts(dt: number): void {
    const { separationFt } = this.params;
    const floor = this.airport.elevation + 1000; // below this the tower separates
    const current = new Set<string>();
    for (const a of this.aircraft) a.conflict = a.warning = false;
    for (let i = 0; i < this.aircraft.length; i++) {
      for (let j = i + 1; j < this.aircraft.length; j++) {
        const a = this.aircraft[i];
        const b = this.aircraft[j];
        if (a.alt < floor || b.alt < floor) continue;
        const req = this.requiredSeparation(a, b);
        if (dist(a.x, a.y, b.x, b.y) < req && Math.abs(a.alt - b.alt) < separationFt - 50) {
          a.conflict = b.conflict = true;
          const key = `${a.id}|${b.id}`;
          current.add(key);
          if (!this.conflicts.has(key)) {
            this.stats.incidents++;
            this.score -= 25;
            this.system(`⚠ PÉRDIDA DE SEPARACIÓN: ${a.callsign} / ${b.callsign}. -25`);
          }
          this.score -= 2 * dt;
          continue;
        }
        const pa = this.predict(a, 60);
        const pb = this.predict(b, 60);
        if (dist(pa.x, pa.y, pb.x, pb.y) < req && Math.abs(pa.alt - pb.alt) < separationFt - 50) a.warning = b.warning = true;
      }
    }
    this.conflicts = current;
  }

  private requiredSeparation(a: Aircraft, b: Aircraft): number {
    const base = this.params.separationNm;
    if (!this.params.wakeSeparation || !a.established || !b.established || a.ilsRunway !== b.ilsRunway) return base;
    const [leader, follower] = (a.finalDist ?? 0) < (b.finalDist ?? 0) ? [a, b] : [b, a];
    return Math.max(base, WAKE_MINIMA[leader.perf.wake][follower.perf.wake]);
  }

  private predict(a: Aircraft, seconds: number): { x: number; y: number; alt: number } {
    const p = project(a.x, a.y, a.track, (a.gs * seconds) / 3600);
    const rate = ((a.onGlide ? 750 : a.tgtAlt > a.alt ? a.perf.climb : a.perf.descent) * seconds) / 60;
    return { ...p, alt: a.alt + clamp(a.tgtAlt - a.alt, -rate, rate) };
  }

  private pilotRequests(): void {
    const ap = this.airport;
    for (const a of this.aircraft) {
      if (a.status !== 'active' || a.emergency || this.time - a.lastRequest < 150) continue;
      const level = Math.abs(a.alt - a.tgtAlt) < 100;
      if (!level || this.rng() > this.params.pilotRequestRate * 0.4) continue;
      const cs = this.cs(a);
      if (a.kind === 'arrival' && !a.ilsRunway && a.alt > 6000 && Math.hypot(a.x, a.y) < 22 && this.time - a.lastInstruction > 60) {
        a.lastRequest = this.time;
        this.transmit(a, pilot.requestDescent(cs, a.lang));
      } else if (a.kind === 'departure' && a.tgtAlt < ap.handoffAltitude && this.time - a.lastInstruction > 45) {
        a.lastRequest = this.time;
        this.transmit(a, pilot.requestClimb(cs, a.lang));
      }
    }
  }

  // ---- traffic generation -----------------------------------------------

  private spawnTraffic(): void {
    const p = this.params;
    const room = this.aircraft.length < p.maxAircraft;
    if (this.time >= this.nextArrival) {
      const ok = room && this.spawnArrival(Math.floor(this.rng() * this.airport.entries.length), 0);
      this.nextArrival = this.time + (ok ? this.interval(p.arrivalsPerHour) : 20);
    }
    if (this.time >= this.nextDeparture) {
      const ok = room && this.time - this.lastDeparture > 100 && this.spawnDeparture();
      this.nextDeparture = this.time + (ok ? this.interval(p.departuresPerHour) : 20);
    }
  }

  /** Random gap between spawns for a rate in aircraft per hour. */
  private interval(perHour: number): number {
    if (perHour <= 0) return Infinity;
    const mean = 3600 / perHour;
    return clamp(-Math.log(1 - this.rng()) * mean, mean * 0.35, mean * 2.5);
  }

  private spawnArrival(entryIndex: number, inward: number): boolean {
    const ap = this.airport;
    const entry = ap.entries[entryIndex];
    const from = findFix(ap, entry.fix)!;
    const to = findFix(ap, entry.to)!;
    const hdg = bearing(from.x, from.y, to.x, to.y);
    const pos = project(from.x, from.y, hdg, inward);
    if (this.aircraft.some((o) => dist(o.x, o.y, pos.x, pos.y) < 8 && Math.abs(o.alt - entry.altitude) < 2000)) return false;

    const a = this.createAircraft('arrival', pos.x, pos.y, entry.altitude, hdg, 270);
    a.tgtAlt = entry.altitude;
    a.nav = 'direct';
    a.directFix = to;
    a.entryFix = entry.fix;
    this.aircraft.push(a);

    this.schedule(4 + this.rng() * 8, () => {
      if (a.done || a.status !== 'pending') return;
      a.status = 'active';
      a.lastInstruction = this.time;
      this.transmit(a, pilot.checkInArrival(this.cs(a), a.lang, ap, a.alt, a.tgtAlt, entry.to));
    });
    if (this.rng() < this.params.emergencyRate) {
      this.schedule(40 + this.rng() * 120, () => {
        if (a.done || a.status !== 'active') return;
        const kinds: EmergencyKind[] = ['engine', 'medical', 'fuel'];
        a.emergency = kinds[Math.floor(this.rng() * kinds.length)];
        this.transmit(a, pilot.emergency(this.cs(a), a.lang, a.emergency));
        this.system(`${a.callsign} ha declarado emergencia. Dale prioridad.`);
      });
    }
    return true;
  }

  private spawnDeparture(): boolean {
    const ap = this.airport;
    const rwy = findRunway(ap, ap.departureRunway)!;
    const pos = project(rwy.thrX, rwy.thrY, rwy.heading, rwy.lengthNm);
    if (this.aircraft.some((o) => dist(o.x, o.y, pos.x, pos.y) < 5 && o.alt < 4500)) return false;

    const a = this.createAircraft('departure', pos.x, pos.y, ap.elevation, rwy.heading, 160);
    a.tgtAlt = ap.initialClimb;
    a.exitFix = ap.exits[Math.floor(this.rng() * ap.exits.length)];
    a.checkInAlt = ap.elevation + 1500 + this.rng() * 800;
    this.aircraft.push(a);
    this.lastDeparture = this.time;
    return true;
  }

  private createAircraft(kind: Aircraft['kind'], x: number, y: number, alt: number, hdg: number, ias: number): Aircraft {
    const total = AIRLINES.reduce((s, al) => s + al.weight, 0);
    let pick = this.rng() * total;
    const airline = AIRLINES.find((al) => (pick -= al.weight) < 0) ?? AIRLINES[0];
    let callsign: string;
    do {
      const digits = 2 + Math.floor(this.rng() * 3);
      callsign = airline.icao + String(Math.floor(10 ** (digits - 1) + this.rng() * 9 * 10 ** (digits - 1)));
    } while (this.aircraft.some((o) => o.callsign === callsign));
    const type = airline.types[Math.floor(this.rng() * airline.types.length)];
    const language = this.params.language;
    return {
      id: this.nextId++,
      callsign,
      telephony: airline.telephony,
      type,
      perf: TYPES[type],
      lang: language === 'mixed' ? (airline.spanish ? 'es' : 'en') : language,
      voice: Math.floor(this.rng() * 1e6),
      kind,
      x,
      y,
      alt,
      hdg,
      ias: Math.min(ias, TYPES[type].cruise),
      gs: ias,
      track: hdg,
      tgtAlt: alt,
      tgtHdg: hdg,
      tgtSpd: ias,
      speedAssigned: false,
      turn: null,
      nav: 'heading',
      directFix: null,
      ilsRunway: null,
      established: false,
      onGlide: false,
      finalDist: null,
      status: 'pending',
      entryFix: null,
      exitFix: null,
      emergency: null,
      history: [],
      conflict: false,
      warning: false,
      done: null,
      spawnTime: this.time,
      lastInstruction: this.time,
      lastRequest: this.time,
      lastError: -1e9,
      checkInAlt: 0,
      checkInScheduled: false,
      reminded: false,
      historyTimer: 0,
    };
  }

  // ---- helpers ----------------------------------------------------------

  /** Wind as a ground velocity vector in knots (wind blows FROM windDir). */
  private windVector(): { x: number; y: number } {
    const { windDir, windSpeed } = this.params;
    return { x: -windSpeed * Math.sin(windDir * DEG), y: -windSpeed * Math.cos(windDir * DEG) };
  }

  /** Heading to fly so that the ground track equals `track`, crabbing into the wind. */
  private headingForTrack(track: number, tas: number): number {
    const { windDir, windSpeed } = this.params;
    const cross = (windSpeed * Math.sin((windDir - track) * DEG)) / Math.max(tas, 60);
    return norm360(track + Math.asin(clamp(cross, -0.5, 0.5)) / DEG);
  }

  private cs(a: Aircraft): Phrase {
    return callsignPhrase(a.callsign, a.telephony, a.lang);
  }

  private schedule(delay: number, run: () => void): void {
    this.pending.push({ at: this.time + delay, run });
  }

  private say(a: Aircraft, phrase: Phrase, delay: number): void {
    this.schedule(delay, () => {
      if (!a.done || a.done === 'left') this.transmit(a, phrase);
    });
  }

  private transmit(a: Aircraft, phrase: Phrase): void {
    this.onTransmission({ id: this.nextTx++, time: this.time, from: 'pilot', callsign: a.callsign, text: phrase.text, spoken: phrase.spoken, lang: a.lang, voice: a.voice });
  }

  private system(text: string): void {
    this.onTransmission({ id: this.nextTx++, time: this.time, from: 'system', callsign: null, text, spoken: '', lang: 'es', voice: 0 });
  }
}

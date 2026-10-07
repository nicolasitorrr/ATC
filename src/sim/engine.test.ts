import { describe, expect, it } from 'vitest';
import type { Command, Interpretation } from '../../shared/types';
import { LEBL, findRunway } from './airports';
import { PRESETS, type SimParams } from './difficulty';
import { type Aircraft, Sim, type Transmission } from './engine';
import { project } from './geo';

const quiet: SimParams = {
  ...PRESETS.student.params,
  arrivalsPerHour: 0,
  departuresPerHour: 0,
  initialTraffic: 1,
  pilotRequestRate: 0,
  responseDelay: [0, 0],
  windSpeed: 0,
};

const tell = (callsign: string, commands: Command[]): Interpretation => ({ callsign, commands, query: null, reply: null, understood: true, source: 'local' });

function setup(params: SimParams = quiet) {
  const sim = new Sim(LEBL, params, 42);
  const heard: Transmission[] = [];
  sim.onTransmission = (t) => heard.push(t);
  return { sim, heard };
}

/** Put an aircraft on a 25 degree intercept to the 25R localizer, 12 NM out. */
function onBaseLeg(a: Aircraft) {
  const rwy = findRunway(LEBL, '25R')!;
  const onFinal = project(rwy.thrX, rwy.thrY, rwy.heading + 180, 12);
  const pos = project(onFinal.x, onFinal.y, rwy.heading + 90, 2);
  Object.assign(a, { x: pos.x, y: pos.y, alt: 3000, tgtAlt: 3000, hdg: 221, tgtHdg: 221, ias: 200, nav: 'heading', directFix: null });
}

describe('Sim', () => {
  it('checks in the initial arrival', () => {
    const { sim, heard } = setup();
    sim.advance(15);
    expect(sim.aircraft).toHaveLength(1);
    expect(sim.aircraft[0].status).toBe('active');
    expect(heard[0].text).toContain(sim.aircraft[0].callsign);
  });

  it('reads back and flies an instruction', () => {
    const { sim, heard } = setup();
    sim.advance(15);
    const a = sim.aircraft[0];
    sim.handleController(tell(a.callsign, [{ type: 'heading', value: 90 }, { type: 'altitude', value: 7000 }]), null);
    sim.advance(1);
    expect(a.tgtHdg).toBe(90);
    expect(a.tgtAlt).toBe(7000);
    expect(heard.at(-1)!.text).toMatch(/090/);
    sim.advance(300);
    expect(Math.round(a.hdg)).toBe(90);
    expect(Math.round(a.alt)).toBe(7000);
  });

  it('refuses what the aircraft cannot do', () => {
    const { sim, heard } = setup();
    sim.advance(15);
    const a = sim.aircraft[0];
    sim.handleController(tell(a.callsign, [{ type: 'altitude', value: 500 }, { type: 'direct', fix: 'NOPE' }]), null);
    sim.advance(1);
    expect(a.tgtAlt).toBeGreaterThan(5000);
    expect(a.lang === 'en' ? heard.at(-1)!.text : 'unable').toContain('unable');
  });

  it('lands an arrival vectored to the ILS and handed to tower', () => {
    const { sim } = setup();
    sim.advance(15);
    const a = sim.aircraft[0];
    onBaseLeg(a);
    sim.handleController(tell(a.callsign, [{ type: 'ils', runway: '25R' }]), null);
    sim.advance(120);
    expect(a.established).toBe(true);
    sim.handleController(tell(a.callsign, [{ type: 'contact', facility: 'tower' }]), null);
    sim.advance(400);
    expect(sim.stats.landed).toBe(1);
    expect(sim.stats.goArounds).toBe(0);
    expect(sim.score).toBe(100);
  });

  it('holds the localizer in a crosswind', () => {
    const { sim } = setup({ ...quiet, windDir: 340, windSpeed: 30 });
    sim.advance(15);
    const a = sim.aircraft[0];
    onBaseLeg(a);
    sim.handleController(tell(a.callsign, [{ type: 'ils', runway: '25R' }, { type: 'contact', facility: 'tower' }]), null);
    sim.advance(500);
    expect(sim.stats.landed).toBe(1);
  });

  it('goes around when nobody hands it to tower', () => {
    const { sim } = setup();
    sim.advance(15);
    const a = sim.aircraft[0];
    onBaseLeg(a);
    sim.handleController(tell(a.callsign, [{ type: 'ils', runway: '25R' }]), null);
    sim.advance(400);
    expect(sim.stats.goArounds).toBe(1);
    expect(sim.stats.landed).toBe(0);
    expect(a.tgtAlt).toBe(LEBL.missedApproachAltitude);
  });

  it('flags a loss of separation once per pair', () => {
    const { sim } = setup({ ...quiet, initialTraffic: 2 });
    sim.advance(15);
    const [a, b] = sim.aircraft;
    Object.assign(b, { x: a.x + 1, y: a.y, alt: a.alt, tgtAlt: a.alt, hdg: a.hdg, tgtHdg: a.hdg, nav: 'heading', directFix: null });
    Object.assign(a, { nav: 'heading', directFix: null, tgtHdg: a.hdg });
    sim.advance(10);
    expect(sim.stats.incidents).toBe(1);
    expect(a.conflict && b.conflict).toBe(true);
    expect(sim.score).toBeLessThan(0);
  });

  it('makes pilots mishear when the error rate says so', () => {
    const { sim } = setup({ ...quiet, pilotErrorRate: 1 });
    sim.advance(15);
    const a = sim.aircraft[0];
    sim.handleController(tell(a.callsign, [{ type: 'heading', value: 180 }]), null);
    sim.advance(1);
    expect(a.tgtHdg).not.toBe(180);
    expect([160, 170, 190, 200]).toContain(a.tgtHdg);
  });

  it('scores a clean departure hand-off', () => {
    const { sim } = setup({ ...quiet, initialTraffic: 0, departuresPerHour: 60 });
    sim.advance(200);
    const d = sim.aircraft.find((x) => x.kind === 'departure')!;
    expect(d.status).toBe('active');
    sim.handleController(tell(d.callsign, [{ type: 'altitude', value: 14000 }, { type: 'direct', fix: d.exitFix! }, { type: 'contact', facility: 'center' }]), null);
    sim.advance(1);
    expect(d.status).toBe('center');
    expect(sim.stats.departed).toBe(1);
    expect(sim.score).toBe(60);
  });

  it('survives an unattended hour at every difficulty', () => {
    for (const preset of Object.values(PRESETS)) {
      const { sim, heard } = setup(preset.params);
      sim.advance(3600);
      expect(sim.aircraft.length).toBeLessThanOrEqual(preset.params.maxAircraft);
      expect(heard.length).toBeGreaterThan(0);
      for (const a of sim.aircraft) expect(Number.isFinite(a.x + a.y + a.alt + a.hdg + a.ias)).toBe(true);
    }
  });

  it('penalises traffic that leaves the sector unattended', () => {
    const { sim } = setup();
    sim.advance(15);
    const a = sim.aircraft[0];
    sim.handleController(tell(a.callsign, [{ type: 'heading', value: 360 }]), null);
    Object.assign(a, { x: 0, y: 44, hdg: 360 });
    sim.advance(120);
    expect(sim.stats.busts).toBe(1);
    expect(sim.aircraft).toHaveLength(0);
  });
});

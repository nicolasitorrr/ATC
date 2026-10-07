import { describe, expect, it } from 'vitest';
import type { InterpretContext } from '../../shared/types';
import { normalize, parseTransmission } from './parser';

const ctx: InterpretContext = {
  airport: 'LEBL',
  approachName: 'Barcelona Approach',
  transitionAltitude: 6000,
  arrivalRunway: '25R',
  departureRunway: '25L',
  fixes: ['SLL', 'TEBLA', 'ALBER'],
  aircraft: [
    { callsign: 'VLG1234', telephony: 'Vueling', kind: 'arrival', altitude: 12000, heading: 200, speed: 270, lang: 'es' },
    { callsign: 'IBE345', telephony: 'Iberia', kind: 'arrival', altitude: 9000, heading: 90, speed: 250, lang: 'es' },
    { callsign: 'RYR88', telephony: 'Ryanair', kind: 'departure', altitude: 4000, heading: 246, speed: 250, lang: 'en' },
    { callsign: 'AFR61', telephony: 'Air France', kind: 'arrival', altitude: 8000, heading: 180, speed: 250, lang: 'en' },
  ],
  selected: null,
};

describe('normalize', () => {
  it('joins spoken digits', () => {
    expect(normalize('Turn left heading two five zero')).toBe('turn left heading 250');
    expect(normalize('descend flight level niner zero')).toBe('descend flight level 90');
  });
  it('understands thousands and hundreds in both languages', () => {
    expect(normalize('descend five thousand feet')).toBe('descend 5000 feet');
    expect(normalize('climb one thousand five hundred')).toBe('climb 1500');
    expect(normalize('descienda a cinco mil pies')).toBe('descienda a 5000 pies');
    expect(normalize('mantenga dos mil quinientos pies')).toBe('mantenga 2500 pies');
  });
});

describe('phraseology', () => {
  it('parses a compound English instruction', () => {
    const r = parseTransmission('Vueling one two three four, turn left heading two five zero, descend flight level eight zero, reduce speed two one zero knots', ctx);
    expect(r.callsign).toBe('VLG1234');
    expect(r.commands).toEqual([
      { type: 'heading', value: 250, turn: 'left' },
      { type: 'altitude', value: 8000 },
      { type: 'speed', value: 210 },
    ]);
  });

  it('parses a Spanish approach clearance', () => {
    const r = parseTransmission('Iberia tres cuatro cinco, descienda a cinco mil pies, autorizado aproximación ILS pista dos cinco derecha', ctx);
    expect(r.callsign).toBe('IBE345');
    expect(r.commands).toEqual([
      { type: 'altitude', value: 5000 },
      { type: 'ils', runway: '25R' },
    ]);
  });

  it('does not mistake a speed for an altitude', () => {
    const r = parseTransmission('Air France six one maintain speed one eight zero', ctx);
    expect(r.callsign).toBe('AFR61');
    expect(r.commands).toEqual([{ type: 'speed', value: 180 }]);
  });

  it('parses directs and hand-offs', () => {
    expect(parseTransmission('Ryanair eight eight proceed direct to SLL climb flight level one three zero', ctx).commands).toEqual([
      { type: 'altitude', value: 13000 },
      { type: 'direct', fix: 'SLL' },
    ]);
    expect(parseTransmission('Ryanair 88 contact Barcelona Control 133.125', ctx).commands).toEqual([{ type: 'contact', facility: 'center' }]);
    expect(parseTransmission('Vueling 1234 con torre 118.1 adiós', ctx).commands).toEqual([{ type: 'contact', facility: 'tower' }]);
  });

  it('treats "expect" as information, not a clearance', () => {
    const r = parseTransmission('Vueling 1234 expect ILS approach runway 25 right', ctx);
    expect(r.commands).toEqual([]);
    expect(r.reply).toBe('Roger');
  });

  it('recognises queries', () => {
    expect(parseTransmission('Iberia 345 say heading', ctx).query).toBe('say_heading');
  });

  it('falls back to the selected aircraft when no callsign is spoken', () => {
    const r = parseTransmission('heading 090', { ...ctx, selected: 'RYR88' });
    expect(r.callsign).toBe('RYR88');
    expect(r.commands[0]).toMatchObject({ type: 'heading', value: 90 });
  });
});

describe('shorthand', () => {
  it('parses a chain of commands', () => {
    const r = parseTransmission('vlg1234 l 250 a 50 s 210 ils twr', ctx);
    expect(r.shorthand).toBe(true);
    expect(r.callsign).toBe('VLG1234');
    expect(r.commands).toEqual([
      { type: 'heading', value: 250, turn: 'left' },
      { type: 'altitude', value: 5000 },
      { type: 'speed', value: 210 },
      { type: 'ils', runway: null },
      { type: 'contact', facility: 'tower' },
    ]);
  });

  it('is not triggered by ordinary speech', () => {
    expect(parseTransmission('Vueling 1234 heading 250', ctx).shorthand).toBe(false);
  });
});

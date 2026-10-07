import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { COMMAND_TYPES, QUERY_TYPES, type Interpretation, type InterpretRequest } from '../shared/types';

export const MODEL = process.env.ATC_MODEL || 'claude-opus-5-5';

const OutputSchema = z.object({
  callsign: z.string().nullable(),
  commands: z.array(
    z.object({
      type: z.enum(COMMAND_TYPES),
      value: z.number().nullable(),
      turn: z.enum(['left', 'right']).nullable(),
      fix: z.string().nullable(),
      runway: z.string().nullable(),
      facility: z.enum(['tower', 'center']).nullable(),
    }),
  ),
  query: z.enum(QUERY_TYPES).nullable(),
  reply: z.string().nullable(),
  understood: z.boolean(),
});

const SYSTEM = `You are the radio-comprehension layer of an air traffic control training simulator. The human is the approach controller. You receive one controller transmission, usually produced by speech recognition and therefore noisy, plus the traffic currently on frequency. Work out which aircraft is addressed and which instructions it was given. The simulator, not you, flies the aircraft and voices the readback, so report only what the controller actually said.

The transmission may be in English or Spanish aviation phraseology, with ICAO number pronunciation ("tree", "fife", "niner", "decimal") and speech-recognition mistakes (for example "Vueling" heard as "welling" or "bueling", "heading" as "heaving", digits fused or split). Use the traffic list to resolve these: the addressed aircraft is almost always one of the listed callsigns, matched by airline telephony name and flight number. Return its ICAO callsign exactly as listed. If no callsign is spoken and a selected aircraft is given, use that one. If you cannot tell which aircraft is meant, return callsign null.

Instruction types:
- heading: value is the heading in degrees. Set turn only when a direction was explicitly given.
- present_heading: continue or fly present heading.
- altitude: value is always in feet. Flight level 120 is 12000. Climb, descend and maintain all map here.
- speed: value in knots IAS.
- resume_speed: no speed restrictions, resume normal speed.
- direct: fix is the waypoint name, chosen from the listed fixes when the spoken name is close to one.
- ils: cleared for the ILS approach. runway like "25R", or null if not stated. "Expect ILS" is not a clearance; do not emit it.
- contact: hand-off. facility is "tower" or "center" (control, radar and en-route all mean center).
- go_around: instructed to go around.
Leave fields that do not apply to an instruction as null.

query is for when the controller only asks the pilot to report something: say_altitude, say_heading, say_speed or radio_check.

reply is for transmissions that need a spoken answer but carry no instruction the simulator can fly: information to expect a runway or approach, traffic information, greetings, or anything else a pilot would acknowledge. Write what that pilot would say back, briefly, in the language the controller used, ending with the callsign spoken as telephony name plus individual digits, and write every number as individual spoken digits. Otherwise leave reply null.

Set understood to false only when the transmission is unintelligible or contains nothing addressed to a pilot.`;

const format = zodOutputFormat(OutputSchema);
let client: Anthropic | null = null;

export async function interpret(req: InterpretRequest): Promise<Interpretation> {
  client ??= new Anthropic();
  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    // Opus 5.5 always thinks; keep it shallow because a pilot is waiting to answer.
    // Haiku 4.5 rejects the effort parameter.
    output_config: MODEL.includes('haiku') ? { format } : { format, effort: 'low' },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `Traffic and airspace:\n${JSON.stringify(req.context)}\n\nController transmission:\n${req.transcript}`,
      },
    ],
  });
  const out = response.parsed_output;
  if (response.stop_reason === 'refusal' || !out) throw new Error(`no interpretation (stop_reason: ${response.stop_reason})`);
  return { ...out, source: 'claude' };
}

# ATC Sim

Simulador web de control de aproximación al estilo VATSIM. Tú eres el controlador de **Barcelona Aproximación (LEBL)**; los pilotos son IA: se presentan en frecuencia, colacionan tus instrucciones por voz, a veces se equivocan y de vez en cuando declaran emergencia.

## Puesta en marcha

Requiere Node.js 20 o superior.

```bash
npm install
cp .env.example .env   # opcional: añade tus claves
npm run dev            # http://localhost:5173
```

Sin claves funciona igualmente: intérprete de fraseología por reglas y voz del navegador (Chrome o Edge para el micrófono). Con claves mejora:

| Variable | Para qué |
|---|---|
| `ANTHROPIC_API_KEY` | Claude interpreta lo que dices por radio, aunque el reconocimiento de voz lo haya transcrito mal |
| `OPENAI_API_KEY` | Reconocimiento de voz más fiable y voces de piloto distintas con efecto de radio |
| `ATC_MODEL` | Modelo de Claude (por defecto `claude-opus-5-5`; `claude-haiku-4-5` responde antes) |

Otros comandos: `npm test`, `npm run build`, `npm start` (sirve la versión compilada en el puerto 8787).

## Cómo se juega

- **Llegadas** (banda amarilla): entran por ALBER, LESBA, RULOS, VIBIM o MATEX. Bájalas, vectorízalas al localizador de la 25R con menos de 30° de interceptación, autoriza el ILS y transfiérelas a torre antes de 1,5 NM o frustrarán.
- **Salidas** (banda azul): despegan de la 25L y te llaman subiendo a 5000 ft. Súbelas al menos a FL130, mándalas directo a su punto de salida y transfiérelas a control.
- Mantén 3 NM o 1000 ft entre aviones (más por estela en final si está activada).

### Hablar a los pilotos

Mantén pulsado **Espacio** (o el botón PTT) y habla, en inglés o español:

> Vueling one two three four, turn left heading two five zero, descend flight level eight zero
>
> Iberia tres cuatro cinco, descienda a cinco mil pies, autorizado aproximación ILS pista dos cinco derecha

O escribe. Con un avión seleccionado en el radar no hace falta el indicativo:

| Atajo | Instrucción |
|---|---|
| `h 250` · `l 250` · `r 250` | rumbo (viraje libre, izquierda, derecha) |
| `a 5000` · `a 50` · `fl120` | altitud o nivel de vuelo |
| `s 210` · `ns` | velocidad · velocidad normal |
| `d SLL` | directo a un punto |
| `ils` | autorizado ILS de la pista en servicio |
| `twr` · `ctr` | transferir a torre · a control |
| `ga` · `ph` | motor y al aire · mantener rumbo actual |

Se pueden encadenar: `VLG1234 l 250 a 50 s 210 ils`.

### Dificultad

Cinco niveles (Alumno, Fácil, Normal, Difícil, Experto) y todos los parámetros ajustables: tráfico por hora, colaciones erróneas, "say again", emergencias, peticiones de los pilotos, viento, separación mínima, estela, idioma en frecuencia, velocidad de habla, ruido de radio y velocidad de simulación.

## Estructura

```
shared/types.ts        tipos comunes cliente/servidor
server/                API: Claude (interpretación) y OpenAI (audio)
src/sim/engine.ts      simulación: física, ILS, tráfico, puntuación, pilotos
src/sim/parser.ts      intérprete local de fraseología y atajos
src/sim/phraseology.ts lo que dicen los pilotos, en inglés y español
src/sim/airports.ts    datos del aeropuerto
src/sim/difficulty.ts  niveles y parámetros
src/voice/             micrófono (STT) y voces (TTS)
src/ui/                radar, fichas de vuelo, comunicaciones, configuración
```

## Limitaciones conocidas

- Un solo aeropuerto y una sola configuración (LEBL oeste). La geometría de pistas es realista, pero **las posiciones de los puntos son aproximadas** y están colocadas para jugar. No sirve para navegación real.
- No hay esperas, SID/STAR publicadas ni tráfico VFR.
- La pista no modela ocupación: la separación en final se penaliza, pero dos aterrizajes muy seguidos no provocan frustrada.

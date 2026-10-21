# vibedom

Atmósferas sonoras procedurales para webs: una web se analiza, se traduce a una **Semilla Sonora** (JSON) y el navegador la convierte en un *soundscape* infinito con Tone.js.

Este repo implementa la **Fase 1** de [la especificación](especificaciones_del_proyecto_web_to_audio.md): el motor procedural y una página de prueba con tres presets muy distintos.

## Demo

Online: **https://germantes.github.io/vibedom/**

En local:

```bash
npm run dev        # http://localhost:5173
```

Abre la página, pulsa **Reproducir** y prueba los tres presets. El motor reacciona al scroll y al hover sobre enlaces (cada preset modula un parámetro distinto). El JSON del preset activo se muestra en pantalla.

> El audio arranca solo tras un clic (política de autoplay de los navegadores). Tone.js se descarga desde CDN en ese primer clic, no al cargar la página.

## Estructura

```
index.html                 demo (3 botones de preset, osciloscopio, JSON)
src/demo/                  controlador y estilos de la demo
src/engine/scales.js       notas, escalas y acordes diatónicos (MIDI puro)
src/engine/seed.js         validación/saneado del contrato JSON
src/engine/generative.js   Markov armónico, voice leading, arpegio, mapeo de scroll
src/engine/soundscape.js   motor Tone.js (grafo de audio y secuenciación)
src/engine/reactivity.js   DOM → motor (scroll y hover)
presets/*.json             semillas de ejemplo
test/                      tests unitarios (node:test)
```

## Motor de audio

```
drone (sine) ─────────────────┐
pad (PolySynth fat*) → padFilter ─┤
                            ├→ chorus → reverb → limiter → master → salida
arp (Synth) → arpFilter → delay ┘                                 └→ analizador
aire (ruido rosa) → autoFilter ────→ reverb
```

* **Pad**: tétradas diatónicas con `PolySynth` de osciladores `fat*` desafinados; cada acorde se escalona unos milisegundos para que no ataque como un bloque.
* **Armonía**: cadena de Markov sobre los grados *no disminuidos* de la escala, con gravedad hacia tónica y movimientos de cuarta/quinta; `voiceLead` transpone el acorde siguiente por octavas para minimizar el movimiento. La duración de cada acorde se calcula a partir del `attack` para que el pad respire.
* **Drone**: tónica/quinta una octava por debajo, cada cuatro acordes.
* **Arpegio**: paseo aleatorio por grados de la escala con pared elástica, gravedad hacia las notas del acorde, probabilidad por paso (`density`), humanización de timing (`Tone.Loop.humanize`) y longitudes variables.
* **Aire**: ruido rosa muy bajo tras un `AutoFilter`, para que no haya silencios entre acordes.
* **Reactividad**: `scroll` → intensidad suavizada (con caída) → `scrollTarget` (`filterFreq`, `reverbWet`, `delayWet`, `arpDensity`) escalado por `scrollMultiplier`; `pointerover` en elementos interactivos → nota suave de la escala (antirrebote 120 ms).

Todo el estado vive en el JSON: no hay IA en tiempo de reproducción y no se sirve audio pregrabado.

## Contrato (Semilla Sonora)

El esquema es el de la spec (sección 4). `normalizeSeed()` aplica dos políticas:

* **Estructura** (tipos, enums, colores hex, nota raíz, escala): si algo falla, lanza `SeedError` con **todos** los problemas a la vez.
* **Rangos numéricos**: se recortan a un rango seguro (`RANGES` en `src/engine/seed.js`) — el LLM puede pasarse de frenada sin romper el motor.

`synthConfig.interactivity.scrollTarget` admite `filterFreq`, `reverbWet`, `delayWet` y `arpDensity`.

## Presets

* `presets/cyberpunk.json` — Re frigio, 84 BPM, sierras, filtro cerrado, arpegio con eco.
* `presets/editorial.json` — Fa lidio, 56 BPM, senos, reverb larga, arpegio muy disperso.
* `presets/indie-pastel.json` — Sol pentatónico, 92 BPM, triángulos, chorus marcado, arpegio denso.

Para añadir uno, crea el JSON en `presets/` y regístralo en `PRESET_IDS` (`src/demo/main.js`). Los tests comprueban que todos los presets cumplen el contrato sin recortes.

## Tests

```bash
npm test
```

Cubren escalas/acordes, validación de la semilla (incluidos los presets reales) y la lógica generativa (progresión sin grados disminuidos ni repeticiones, voice leading acotado, arpegio dentro de rango y con gravedad armónica, mapeo de scroll).

## Roadmap

* **Fase 2**: escáner de URL (DOM/CSS computado) + LLM con *structured outputs* → Semilla Sonora.
* **Fase 3**: playground con análisis estético en vivo y sliders.
* **Fase 4**: widget embebible < 5 KB con Shadow DOM, Tone.js bajo demanda y generador de snippet para Framer/Webflow.

# vibedom

Atmósferas sonoras procedurales para webs: una web se analiza, se traduce a una **Semilla Sonora** (JSON) y el navegador la convierte en un *soundscape* infinito con Tone.js.

El proyecto implementa las fases 1–3 de [la especificación](especificaciones_del_proyecto_web_to_audio.md): motor procedural, escáner de URL con LLM y playground con análisis animado, sliders y visualizador.

## Demo

Online (presets): **https://germantes.github.io/vibedom/**

El escaneo de URLs necesita el backend local, porque GitHub Pages solo sirve archivos estáticos.

```bash
# Crea .env en la raíz con GEMINI_KEY=...
npm start              # http://localhost:3000
```

Abre la página, pega una URL y pulsa **Escanear**. También puedes probar los tres presets sin backend.

> El audio arranca tras un gesto del usuario (política de autoplay). Tone.js se descarga desde CDN en ese primer gesto, nunca al cargar la página.

## Cómo funciona

1. **Escaneo** (`POST /api/scan`): el servidor valida la URL (incluida la resolución DNS) para bloquear destinos privados y descarga el HTML y hasta cuatro hojas de estilo.
2. **Análisis estético** (`src/backend/scraper.js`): paleta, color de fondo dominante, luminancia, familias tipográficas, jerarquía de encabezados, animaciones y transiciones.
3. **Traducción** (`src/backend/translator.js`): Gemini Flash con *structured output* devuelve la Semilla Sonora. Hay timeout por intento, deadline total, reintentos con backoff + jitter y cadena de modelos de respaldo.
4. **Saneado** (`src/engine/seed.js`): el contrato se valida y los números fuera de rango se recortan antes de llegar al navegador.
5. **Síntesis** (`src/engine/soundscape.js`): el cliente construye el grafo de audio y genera pad, drone y arpegio de forma infinita. No hay audio pregrabado ni streaming.

## Playground

- **Animación de análisis** con pasos, progreso y tiempo real transcurrido; se puede **cancelar** y **reintentar**.
- **Sliders en caliente** (sin volver a llamar a la IA): tempo, brillo del filtro, espacialidad de la reverb y densidad del arpegio. Si el audio suena, el cambio se aplica al instante.
- **Regenerar variación**: salta a otro grado de la escala y dispara un acorde nuevo.
- **Visualizador enriquecido**: espectro de barras y osciloscopio en canvas, teñidos con la paleta de la web analizada.
- **Tema adoptado**: fondo, texto, acento y familia tipográfica de la web escaneada se aplican a toda la interfaz.

## Estructura

```
index.html                 playground (escaneo, sliders, visualizador, JSON)
favicon.svg
src/backend/scraper.js     extracción HTML/CSS sin dependencias
src/backend/translator.js  Gemini + reintentos, fallback, timeout y schema
src/backend/url-guard.js   validación anti-SSRF (DNS, IPs privadas, redirects)
src/backend/server.js      servidor node:http (estáticos + /api/scan)
src/demo/main.js           orquestación de la UI
src/demo/analysis.js       estados y animación del panel de análisis
src/demo/controls.js       sliders y mapeo logarítmico de brillo
src/demo/visualizer.js     espectro + osciloscopio en canvas
src/demo/demo.css          estilos basados en variables CSS de la semilla
src/engine/scales.js       notas, escalas y acordes diatónicos (MIDI puro)
src/engine/seed.js         validación/saneado del contrato JSON
src/engine/generative.js   Markov armónico, voice leading, arpegio, scroll
src/engine/soundscape.js   motor Tone.js (grafo de audio y secuenciación)
src/engine/reactivity.js   DOM → motor (scroll y hover)
presets/*.json             semillas de ejemplo
test/                      tests unitarios con node:test
```

## Motor de audio

```
drone (sine) ─────────────────┐
pad (PolySynth fat*) → padFilter ─┤
                            ├→ chorus → reverb → limiter → master → salida
arp (Synth) → arpFilter → delay ┘                                 ├→ analizador
                                                                  └→ FFT
```

* **Pad**: tétradas diatónicas con `PolySynth` de osciladores `fat*` desafinados; cada acorde se escalona unos milisegundos para que no ataque como un bloque.
* **Armonía**: cadena de Markov sobre los grados *no disminuidos* de la escala, con gravedad hacia tónica y movimientos de cuarta/quinta; `voiceLead` transpone el acorde siguiente por octavas para minimizar el movimiento.
* **Drone**: tónica/quinta una octava por debajo, cada cuatro acordes.
* **Arpegio**: paseo aleatorio por grados de la escala con pared elástica, gravedad hacia las notas del acorde, probabilidad por paso (`density`), humanización de timing (`Tone.Loop.humanize`) y longitudes variables.
* **Reactividad**: `scroll` → intensidad suavizada → `scrollTarget` (`filterFreq`, `reverbWet`, `delayWet`, `arpDensity`) escalado por `scrollMultiplier`; `pointerover` en elementos interactivos → nota suave de la escala (antirrebote 120 ms).
* **CPU**: `Tone.Freeverb` en lugar de convolución, `latencyHint: "playback"` y `lookAhead: 0.3 s` para evitar dropouts.

Todo el estado vive en el JSON: no hay IA en tiempo de reproducción y no se sirve audio pregrabado.

## Contrato (Semilla Sonora)

El esquema es el de la spec (sección 4). `normalizeSeed()` aplica dos políticas:

* **Estructura** (tipos, enums, colores hex, nota raíz, escala): si algo falla, lanza `SeedError` con **todos** los problemas a la vez.
* **Rangos numéricos**: se recortan a un rango seguro (`RANGES` en `src/engine/seed.js`) — el LLM puede pasarse de frenada sin romper el motor.

`synthConfig.interactivity.scrollTarget` admite `filterFreq`, `reverbWet`, `delayWet` y `arpDensity`.

## Backend

- `POST /api/scan` con `{ "url": "https://..." }` → `200` con la Semilla Sonora, o `400`/`422`/`502`/`504` con `{ error }`.
- Archivos estáticos del repositorio en el resto de rutas.
- **Sin dependencias npm**: `node:http`, `fetch` nativo y regex. Node ≥ 20.
- Variables: `GEMINI_KEY` (obligatoria para escanear), `PORT` (3000 por defecto) y `VIBEDOM_ALLOW_PRIVATE=1` (solo desarrollo, permite escanear hosts privados).
- Modelos: `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash`. No uses `gemini-2.x` (retirado para esta clave) ni `gemini-3.8-flash` (latencia inaceptable).
- El servidor valida cada salto de redirección y cada hoja de estilos para evitar SSRF, bloquea dotfiles y *path traversal*, y limita el cuerpo de las peticiones a 16 KB.

## Presets

* `presets/cyberpunk.json` — Re frigio, 84 BPM, sierras, filtro cerrado, arpegio con eco.
* `presets/editorial.json` — Fa lidio, 56 BPM, senos, reverb larga, arpegio muy disperso.
* `presets/indie-pastel.json` — Sol pentatónico, 92 BPM, triángulos, chorus marcado, arpegio denso.

Para añadir uno, crea el JSON en `presets/` y regístralo en `PRESET_IDS` (`src/demo/main.js`). Los tests comprueban que todos los presets cumplen el contrato sin recortes.

## Tests

```bash
npm test
```

**52 tests** con `node:test`, sin dependencias:

* escalas, acordes y conversión MIDI;
* validación de la semilla y presets reales;
* lógica generativa (Markov sin grados disminuidos, voice leading acotado, arpegio, scroll);
* scraper con HTML/CSS simulado (paleta, tipografía, colores con alfa, entidades, límites);
* traductor con `fetch` falso (reintentos, fallback de modelos, timeout, errores);
* guard anti-SSRF (IPs privadas, redirects, DNS);
* servidor (rutas estáticas, `/api/scan`, 405/413/404, path traversal y cancelación).

El flujo real se validó en navegador con Playwright: presets, play/pausa, sliders, regeneración, espectro, escaneo de `example.com` (~3 s), cancelación, errores y responsive.

## Roadmap

* **Fase 4**: widget embebible < 5 KB con Shadow DOM, Tone.js bajo demanda y generador de snippet para Framer/Webflow.

> El snippet deberá apuntar al origen desplegado (`location.origin`) en lugar de una URL fija.

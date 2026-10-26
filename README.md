# vibedom

Atmósferas sonoras procedurales para webs: una web se analiza, se traduce a una **Semilla Sonora** (JSON) y el navegador la convierte en un *soundscape* infinito con Tone.js.

El producto tiene dos capas:

- **Landing comercial** (`/` y `/en/`): propuesta, demo de presets, escaneo de URL, privacidad, FAQ y acceso al laboratorio.
- **Playground** (`/playground/` y `/playground/en/`): el laboratorio técnico con la semilla JSON, sliders en caliente, regeneración y visualizador.

La interfaz está disponible en **español e inglés** mediante rutas estáticas (`/` y `/en/`), con `hreflang` y sin dependencia de JavaScript para elegir idioma.

## Demo

Online (presets): **https://germantes.github.io/vibedom/**

> GitHub Pages solo sirve archivos estáticos. Los presets y el audio funcionan online. El escaneo necesita un backend: o el local (`npm start`), o uno desplegado en Render declarado con `<meta name="vibedom-api">`. Si no hay ninguno configurado, la landing lo explica sin lanzar peticiones inútiles.

```bash
# Crea .env en la raíz con GEMINI_KEY=...
npm start              # http://localhost:3000
```

Abre la landing, pega una URL y pulsa **Escuchar mi web**. También puedes probar los tres presets sin backend.

> El audio arranca tras un gesto del usuario (política de autoplay). Tone.js se descarga desde CDN en ese primer gesto, nunca al cargar la página.

### Rutas

| Ruta | Contenido |
| --- | --- |
| `/` | Landing en español |
| `/en/` | Landing en inglés |
| `/playground/` | Playground en español |
| `/playground/en/` | Playground en inglés |

Los enlaces son relativos para funcionar tanto en `localhost:3000` como en un despliegue bajo subruta (GitHub Pages).

## Cómo funciona

1. **Escaneo** (`POST /api/scan`): el servidor valida la URL (incluida la resolución DNS) para bloquear destinos privados y descarga el HTML y hasta cuatro hojas de estilo.
2. **Análisis estético** (`src/backend/scraper.js`): paleta, color de fondo dominante, luminancia, familias tipográficas, jerarquía de encabezados, animaciones y transiciones.
3. **Traducción** (`src/backend/translator.js`): Gemini Flash con *structured output* devuelve la Semilla Sonora. Hay timeout por intento, deadline total, reintentos con backoff + jitter y cadena de modelos de respaldo.
4. **Saneado** (`src/engine/seed.js`): el contrato se valida y los números fuera de rango se recortan antes de llegar al navegador.
5. **Síntesis** (`src/engine/soundscape.js`): el cliente construye el grafo de audio y genera pad, drone y arpegio de forma infinita. No hay audio pregrabado ni streaming.

## Landing

- Hero con una acción principal: pegar una URL y escuchar.
- Demo inmediata con tres presets, botón de play, espectro, osciloscopio y paleta de la semilla.
- Panel de análisis animado y cancelable durante el escaneo; el resultado se reproduce automáticamente si el navegador lo permite.
- Secciones de cómo funciona, identidad sonora, privacidad, CTA al playground y FAQ.
- Sin JSON ni sliders a la vista: esos viven en el playground.
- Si la página se sirve desde GitHub Pages (`github.io`), el escaneo se detiene con una explicación y una alternativa por presets. No se hace una petición inútil.

## Playground

- **Animación de análisis** con pasos, progreso y tiempo real transcurrido; se puede **cancelar** y **reintentar**.
- **Sliders en caliente** (sin volver a llamar a la IA): tempo, brillo del filtro, espacialidad de la reverb y densidad del arpegio. Si el audio suena, el cambio se aplica al instante.
- **Regenerar variación**: salta a otro grado de la escala y dispara un acorde nuevo.
- **Visualizador enriquecido**: espectro de barras y osciloscopio en canvas, teñidos con la paleta de la web analizada.
- **Tema adoptado**: fondo, texto, acento y familia tipográfica de la web escaneada se aplican a toda la interfaz.
- **Semilla Sonora visible** y botón para volver a la landing; selector de idioma en la barra superior.

## Internacionalización

`src/i18n.js` contiene los diccionarios ES/EN, `t()` con interpolación y `applyI18n()`, que traduce atributos declarativos:

- `data-i18n` → `textContent`
- `data-i18n-html` → `innerHTML` (solo copia estática de confianza)
- `data-i18n-placeholder`, `data-i18n-aria-label`, `data-i18n-title`, `data-i18n-content`

El idioma se deduce de `<html lang>`. No hay toggle con JavaScript: cada idioma tiene su URL, lo que mejora SEO, enlaces compartibles y el comportamiento sin JS.

## Estructura

```
index.html                   landing ES
en/index.html                landing EN
playground/index.html        playground ES
playground/en/index.html     playground EN
favicon.svg
.nojekyll                    evita el procesado de Jekyll en GitHub Pages
sitemap.xml                  sitemap bilingüe con hreflang
robots.txt                   crawl abierto + referencia al sitemap
render.yaml                  Blueprint de Render (servicio + env)
src/i18n.js                  diccionarios ES/EN y utilidades
src/api.js                   resolución de /api/scan y backend externo
src/landing/main.js          demo, escaneo y audio de la landing
src/landing/landing.css      tema comercial de la landing
src/backend/scraper.js       extracción HTML/CSS sin dependencias
src/backend/translator.js    Gemini + reintentos, fallback, timeout y schema
src/backend/url-guard.js     validación anti-SSRF (DNS, IPs privadas, redirects)
src/backend/rate-limit.js    cuota de escaneos por IP
src/backend/scan-cache.js    caché en memoria de semillas por URL
src/backend/server.js        servidor node:http (estáticos + /api/scan + health)
src/demo/main.js             orquestación del playground
src/demo/analysis.js         estados y animación del panel de análisis
src/demo/controls.js         sliders y mapeo logarítmico de brillo
src/demo/visualizer.js       espectro + osciloscopio en canvas
src/demo/demo.css            estilos basados en variables CSS de la semilla
src/engine/scales.js         notas, escalas y acordes diatónicos (MIDI puro)
src/engine/seed.js           validación/saneado del contrato JSON
src/engine/generative.js     Markov armónico, voice leading, arpegio, scroll
src/engine/soundscape.js     motor Tone.js (grafo de audio y secuenciación)
src/engine/reactivity.js     DOM → motor (scroll y hover)
presets/*.json               semillas de ejemplo
scripts/set-api.mjs          declara el backend externo en las 4 páginas
test/                        tests unitarios con node:test
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

- `POST /api/scan` con `{ "url": "https://..." }` → `200` con la Semilla Sonora, o `400`/`422`/`429`/`502`/`504` con `{ error }`. La cabecera `X-Vibedom-Cache` indica `HIT` o `MISS`.
- `GET /api/health` → `200` con `{ ok: true }`; sirve de health check y despierta el servicio en Render.
- Archivos estáticos del repositorio en el resto de rutas.
- **Sin dependencias npm**: `node:http`, `fetch` nativo y regex. Node ≥ 20.
- Variables: `GEMINI_KEY` (obligatoria para escanear), `PORT` (3000 por defecto), `SCAN_RATE_LIMIT` (10 escaneos/min por IP; `0` lo desactiva), `SCAN_CACHE_TTL` (segundos que se recuerda una semilla; 3600 por defecto, `0` desactiva la caché) y `VIBEDOM_ALLOW_PRIVATE=1` (solo desarrollo, permite escanear hosts privados).
- El servidor valida cada salto de redirección y cada hoja de estilos para evitar SSRF, bloquea dotfiles y *path traversal*, limita el cuerpo de las peticiones a 16 KB y aplica la cuota antes de llamar a Gemini.
- La semilla de cada URL se guarda en memoria una hora (`SCAN_CACHE_TTL`): repetir un escaneo no vuelve a llamar a Gemini.
- Modelos: `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash`. No uses `gemini-2.x` (retirado para esta clave) ni `gemini-3.8-flash` (latencia inaceptable).

### Despliegue

La combinación recomendada es **GitHub Pages para la landing** y **Render para el analizador**:

- La landing y los presets cargan al instante desde Pages.
- Solo el escaneo viaja al backend de Render, que tiene la `GEMINI_KEY` y acceso a Gemini.
- El servidor ya envía CORS y un limitador por IP (`SCAN_RATE_LIMIT`, 10/min por defecto) para proteger la clave.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/germantes/vibedom)

1. Pulsa el botón, conecta GitHub y crea el servicio desde `render.yaml`.
2. Introduce `GEMINI_KEY` cuando Render la pida.
3. Copia la URL del servicio (por ejemplo `https://vibedom.onrender.com`).
4. Declara ese origen en las cuatro páginas:

```bash
npm run set-api -- https://TU-SERVICIO.onrender.com
```

Para quitarlo: `npm run set-api -- --clear`. Sin ese `meta`, GitHub Pages sigue mostrando el aviso estático y los presets. Con él, el escaneo funciona también online. El plan gratuito de Render duerme tras unos minutos de inactividad: la landing hace un `GET /api/health` al cargar para despertarlo, pero el primer análisis puede tardar algo más.

También puedes abrir directamente la URL de Render: el mismo servidor sirve landing, playground y `/api/scan` en un solo origen, sin configurar nada. Es la opción más simple, aunque cada visita en frío espera a que arranque el servicio.

#### Variables de entorno

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `GEMINI_KEY` | Sí | Clave de Google AI Studio para traducir la estética a la semilla. |
| `PORT` | No | Render la inyecta; en local es 3000. |
| `SCAN_RATE_LIMIT` | No | Escaneos por minuto y por IP. Por defecto 10; `0` desactiva el límite. |
| `SCAN_CACHE_TTL` | No | Segundos que se recuerda la semilla de una URL. Por defecto 3600; `0` desactiva la caché. |
| `VIBEDOM_ALLOW_PRIVATE` | No | Solo desarrollo: permite escanear hosts privados. No usar en producción. |

#### Dominio propio

Si usas un dominio propio, actualiza también `canonical`, `og:url`, `sitemap.xml` y `robots.txt`, que hoy apuntan a `https://germantes.github.io/vibedom/`.

## Presets

* `presets/cyberpunk.json` — Re frigio, 84 BPM, sierras, filtro cerrado, arpegio con eco.
* `presets/editorial.json` — Fa lidio, 56 BPM, senos, reverb larga, arpegio muy disperso.
* `presets/indie-pastel.json` — Sol pentatónico, 92 BPM, triángulos, chorus marcado, arpegio denso.

Para añadir uno, crea el JSON en `presets/` y regístralo en `PRESET_IDS` (`src/landing/main.js` y `src/demo/main.js`). Los tests comprueban que todos los presets cumplen el contrato sin recortes.

## Tests

```bash
npm test
```

**63 tests** con `node:test`, sin dependencias:

* escalas, acordes y conversión MIDI;
* validación de la semilla y presets reales;
* lógica generativa (Markov sin grados disminuidos, voice leading acotado, arpegio, scroll);
* scraper con HTML/CSS simulado (paleta, tipografía, colores con alfa, entidades, límites);
* traductor con `fetch` falso (reintentos, fallback de modelos, timeout, errores);
* guard anti-SSRF (IPs privadas, redirects, DNS);
* servidor (rutas estáticas ES/EN y playground, `/api/scan`, health, 405/413/404/429, path traversal y cancelación);
* limitador de peticiones por IP (`X-Forwarded-For`, ventana deslizante y cuota);
* caché de semillas por URL (normalización, TTL, desalojo y acierto sin volver a llamar a Gemini).

El flujo real se validó en navegador con Playwright (fuera del repo): landing ES/EN, presets, play/pausa, espectro, escaneo mockeado, error de backend, responsive a 390 px, playground ES/EN, sliders, JSON y cambio de idioma. También se validó un escaneo real de `example.com` (~3 s).

## Roadmap

* **Fase 4**: widget embebible < 5 KB con Shadow DOM, Tone.js bajo demanda y generador de snippet para Framer/Webflow.
* Desplegar el backend en Render y declarar su URL en `<meta name="vibedom-api">` para habilitar el escaneo en Pages.
* Historial de escaneos recientes y compartir semilla por URL.

> El snippet deberá apuntar al origen desplegado (`location.origin`) en lugar de una URL fija.

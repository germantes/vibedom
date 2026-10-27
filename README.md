# vibedom

Atmósferas sonoras procedurales para webs: una web se analiza, se traduce a una **Semilla Sonora** (JSON) y el navegador la convierte en un *soundscape* infinito con Tone.js.

El producto tiene dos capas:

- **Landing comercial** (`/` y `/en/`): propuesta, demo de presets, escaneo de URL, privacidad, FAQ y acceso al laboratorio.
- **Playground** (`/playground/` y `/playground/en/`): el laboratorio técnico con la semilla JSON, sliders en caliente, regeneración y visualizador.

La interfaz está disponible en **español e inglés** mediante rutas estáticas (`/` y `/en/`), con `hreflang` y sin dependencia de JavaScript para elegir idioma.

## Demo

Online: **https://vibedom.dev/**

> El escaneo funciona online: la landing de GitHub Pages llama al backend desplegado en Render (`https://vibedom.onrender.com`). Ese servicio se duerme tras 15 minutos sin uso y la página lo despierta con `GET /api/health`, así que el primer análisis del día puede tardar unos segundos más.

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
- **Tema dinámico**: al escanear un sitio, la landing adopta su fondo, su texto y su acento (también `theme-color` y `color-scheme`). Elegir un preset devuelve la paleta de marca al instante.
- Si el sitio se sirve en un host estático sin backend propio (GitHub Pages, `file:`, o un dominio con `<meta name="vibedom-api">` externo), se muestra un aviso de espera y `warmApi()` despierta Render antes de escanear.

### Contraste del tema dinámico

La paleta escaneada no es de fiar: un sitio puede tener texto blanco sobre blanco o un acento casi invisible. `src/landing/theme.js` normaliza los hex y calcula contraste WCAG antes de pintar:

* el texto se corrige hasta **≥ 4.5:1** (o se elige el extremo —casi negro o casi blanco— que más contraste dé);
* el acento se mantiene si llega a **3:1** para formas y bordes, y se mezcla hacia blanco/negro hasta **4.5:1** (`--accent-ink`) cuando se usa como texto, incluido el tinte del badge;
* el texto sobre el acento (`--on-accent`) elige entre negro y blanco según contraste;
* el resto de variables (muted, líneas, brillos, sombra) se derivan con `color-mix()` de `--bg`, `--text` y `--accent`.

El playground reutiliza las mismas funciones en su propio `applyTheme`, pero conserva su interfaz técnica (sliders, JSON y espectro).

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
assets/og-es.png              imagen Open Graph ES (1200×630)
assets/og-en.png              imagen Open Graph EN (1200×630)
favicon.svg
.nojekyll                    evita el procesado de Jekyll en GitHub Pages
sitemap.xml                  sitemap bilingüe con hreflang
robots.txt                   crawl abierto + referencia al sitemap
render.yaml                  Blueprint de Render (servicio + env)
src/i18n.js                  diccionarios ES/EN y utilidades
src/api.js                   resolución de /api/scan y backend externo
src/host-mode.js             detección de host estático (Pages, dominio propio, file:)
src/landing/main.js          demo, escaneo y audio de la landing
src/landing/theme.js         contraste WCAG y tema dinámico desde la semilla
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

- `POST /api/scan` con `{ "url": "https://...", "lang": "es" }` → `200` con la Semilla Sonora. Si falla: `400` (URL), `429` (`{ code: "RATE_LIMITED", retryAfter }`) o `502` (`{ code: "ANALYSIS_FAILED" }`) con un mensaje localizado en `error`. `lang` (`es` o `en`) controla el idioma de `detectedVibe` y `explanation`; la caché guarda una entrada por idioma y la cabecera `X-Vibedom-Cache` indica `HIT` o `MISS`.
- `GET /api/health` → `200` con `{ ok: true, service: "vibedom", commit }`; sirve de health check, despierta el servicio en Render y permite comprobar qué commit está desplegado.
- Archivos estáticos del repositorio en el resto de rutas.
- **Sin dependencias npm**: `node:http`, `fetch` nativo y regex. Node ≥ 20.
- Variables: `GEMINI_KEY` (obligatoria para escanear), `PORT` (3000 por defecto), `SCAN_RATE_LIMIT` (5 escaneos/min por IP; `0` lo desactiva), `GEMINI_MIN_INTERVAL_MS` (8 s entre llamadas reales a Gemini), `GEMINI_MAX_WAIT_MS` (25 s de espera máxima en cola), `GEMINI_QUEUE_LIMIT` (10 peticiones en cola), `SCAN_CACHE_TTL` (segundos que se recuerda una semilla; 3600 por defecto, `0` desactiva la caché) y `VIBEDOM_ALLOW_PRIVATE=1` (solo desarrollo, permite escanear hosts privados).
- El servidor valida cada salto de redirección y cada hoja de estilos para evitar SSRF, bloquea dotfiles y *path traversal*, limita el cuerpo de las peticiones a 16 KB y aplica la cuota antes de llamar a Gemini.
- La cuota gratuita de Gemini es **por proyecto, no por IP**: el limitador por IP no basta. Por eso las llamadas se serializan y se espacian (`GEMINI_MIN_INTERVAL_MS`); si Gemini devuelve `429`, no se reintenta ni se prueba otro modelo, se enfría la cola global y se responde `429` con `Retry-After` en lugar de un `502` técnico. Si la espera supera 10 minutos (cupo diario), el mensaje habla de límite de uso y horas, no de decenas de miles de segundos.
- La semilla de cada URL se guarda en memoria una hora (`SCAN_CACHE_TTL`): repetir un escaneo no vuelve a llamar a Gemini.
- Modelos: `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash`. No uses `gemini-2.x` (retirado para esta clave) ni `gemini-3.8-flash` (latencia inaceptable).

### Despliegue

La combinación recomendada es **GitHub Pages para la landing** y **Render para el analizador**:

- La landing y los presets cargan al instante desde Pages.
- Solo el escaneo viaja al backend de Render, que tiene la `GEMINI_KEY` y acceso a Gemini.
- El servidor ya envía CORS y un limitador por IP (`SCAN_RATE_LIMIT`, 5/min por defecto) para proteger la clave.

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
| `SCAN_RATE_LIMIT` | No | Escaneos por minuto y por IP. Por defecto 5; `0` desactiva el límite. |
| `GEMINI_MIN_INTERVAL_MS` | No | Separación mínima entre llamadas reales a Gemini. Por defecto 8000 ms (≈7,5/min). |
| `GEMINI_MAX_WAIT_MS` | No | Espera máxima de una petición en la cola global. Por defecto 25000 ms. |
| `GEMINI_QUEUE_LIMIT` | No | Peticiones que pueden esperar turno a la vez. Por defecto 10. |
| `SCAN_CACHE_TTL` | No | Segundos que se recuerda la semilla de una URL. Por defecto 3600; `0` desactiva la caché. |
| `VIBEDOM_ALLOW_PRIVATE` | No | Solo desarrollo: permite escanear hosts privados. No usar en producción. |

#### Dominio propio

El sitio se publica en `https://vibedom.dev`. Para moverlo a otro dominio:

```bash
npm run set-domain -- https://tu-dominio.dev
```

Reescribe `canonical`, `og:url`, `hreflang`, JSON-LD, `sitemap.xml`, `robots.txt` y la documentación, y genera el `CNAME` que lee GitHub Pages. Hazlo solo cuando el DNS ya apunte a GitHub: en cuanto entra el `CNAME`, `germantes.github.io/vibedom/` redirige al dominio nuevo.

## Presets

* `presets/cyberpunk.json` — Re frigio, 84 BPM, sierras, filtro cerrado, arpegio con eco.
* `presets/editorial.json` — Fa lidio, 56 BPM, senos, reverb larga, arpegio muy disperso.
* `presets/indie-pastel.json` — Sol pentatónico, 92 BPM, triángulos, chorus marcado, arpegio denso.

Para añadir uno, crea el JSON en `presets/` y regístralo en `PRESET_IDS` (`src/landing/main.js` y `src/demo/main.js`). Los tests comprueban que todos los presets cumplen el contrato sin recortes.

## Tests

```bash
npm test
```

**85 tests** con `node:test`, sin dependencias:

* escalas, acordes y conversión MIDI;
* validación de la semilla y presets reales;
* lógica generativa (Markov sin grados disminuidos, voice leading acotado, arpegio, scroll);
* scraper con HTML/CSS simulado (paleta, tipografía, colores con alfa, entidades, límites);
* traductor con `fetch` falso (reintentos, fallback de modelos, timeout, errores);
* guard anti-SSRF (IPs privadas, redirects, DNS);
* servidor (rutas estáticas ES/EN y playground, `/api/scan`, health, 405/413/404/429, path traversal y cancelación);
* limitador de peticiones por IP (`X-Forwarded-For`, ventana deslizante y cuota);
* caché de semillas por URL (normalización, TTL, desalojo y acierto sin volver a llamar a Gemini);
* tema dinámico (normalización de hex, luminancia, contraste WCAG, texto y acento corregidos, mezclas y `rgba()`);
* detección de host estático (Pages, dominio propio, `file:` y API externa);
* idioma de salida del traductor y separación de la caché por idioma.

El flujo real se validó en navegador con Playwright (fuera del repo): landing ES/EN, presets, play/pausa, espectro, escaneo mockeado, error de backend, responsive a 390 px, playground ES/EN, sliders, JSON y cambio de idioma. También se validó un escaneo real de `example.com` (~3 s). El tema dinámico se comprobó con escaneos mockeados (sitio claro, oscuro y un caso hostil blanco sobre blanco) y una auditoría de contraste de 26 elementos en ambos esquemas: 26/26 en claro y 26/26 en oscuro.

## Roadmap

* **Fase 4**: widget embebible < 5 KB con Shadow DOM, Tone.js bajo demanda y generador de snippet para Framer/Webflow.
* Verificación en Search Console, envío del sitemap y página dedicada a «what does my website sound like».
* Historial de escaneos recientes y compartir semilla por URL.

> El snippet deberá apuntar al origen desplegado (`location.origin`) en lugar de una URL fija.

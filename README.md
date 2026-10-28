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

Si Gemini no está disponible (cuota agotada, sin clave o error de red), el paso 3 se sustituye por un **compositor local determinista** (`src/backend/local-seed.js`). Aplica las mismas reglas estéticas —fondo, saturación, tipografía y movimiento— sin IA, así que la demo nunca se queda sin sonido. La semilla se marca con `metadata.source: "local"` y la interfaz lo indica como «análisis local».

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
src/backend/local-seed.js    compositor determinista sin IA (cuota agotada)
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

- `POST /api/scan` con `{ "url": "https://...", "lang": "es" }` → `200` con la Semilla Sonora. `lang` (`es` o `en`) controla el idioma de `detectedVibe` y `explanation`; la caché guarda una entrada por idioma y la cabecera `X-Vibedom-Cache` indica `HIT` o `MISS`.
- **Resiliencia del escaneo**: si la IA devuelve `429` o falla después de descargar las señales, se responde `200` con una semilla local (`metadata.source: "local"`, cabecera `X-Vibedom-Source: local`). Durante un enfriamiento conocido (`429` previo) ni siquiera se espera la cola. La semilla local no se cachea: cuando la cuota vuelve, el siguiente escaneo usa la IA. Si el scraper no puede cargar la web, siguen aplicando `400` (URL), `429` (límite por IP) o `502` (`{ code: "ANALYSIS_FAILED" }`) con un mensaje localizado en `error`.
- `GET /api/health` → `200` con `{ ok: true, service: "vibedom", commit, engine }`; sirve de health check, despierta el servicio en Render y permite comprobar qué commit y qué motor (`vertex`, `gemini` o `local`) están activos.
- **Cabecera `X-Vibedom-Source`**: `vertex`, `gemini` o `local` indican qué produjo la semilla. Útil para verificar un despliegue sin mirar logs.
- Archivos estáticos del repositorio en el resto de rutas.
- **Sin dependencias npm**: `node:http`, `fetch` nativo y regex. Node ≥ 20.
- Variables: `VERTEX_PROJECT_ID` (activa Vertex AI; recomendado), `VERTEX_LOCATION` (por defecto `europe-west4`; `global` usa el endpoint global), `VERTEX_SA_KEY_B64` (JSON de la service account en base64), `VERTEX_SA_KEY_JSON` (la misma clave en crudo, para local), `VERTEX_ACCESS_TOKEN` (token de corta duración, solo para pruebas), `VERTEX_MODELS` (lista separada por comas), `GEMINI_KEY` (alternativa con API key; si no hay Vertex ni key se usa siempre la semilla local), `PORT` (3000 por defecto), `SCAN_RATE_LIMIT` (5 escaneos/min por IP; `0` lo desactiva), `GEMINI_MIN_INTERVAL_MS` (8 s entre llamadas reales a la IA), `GEMINI_MAX_WAIT_MS` (25 s de espera máxima en cola), `GEMINI_QUEUE_LIMIT` (10 peticiones en cola), `SCAN_CACHE_TTL` (segundos que se recuerda una semilla; 3600 por defecto, `0` desactiva la caché), `SCAN_FALLBACK` (`0` desactiva la semilla local de emergencia), `SCAN_FALLBACK_COOLDOWN_S` (enfriamiento mínimo, en segundos, para saltarse la IA; `0` = cualquiera) y `VIBEDOM_ALLOW_PRIVATE=1` (solo desarrollo, permite escanear hosts privados).
- El servidor valida cada salto de redirección y cada hoja de estilos para evitar SSRF, bloquea dotfiles y *path traversal*, limita el cuerpo de las peticiones a 16 KB y aplica la cuota antes de llamar a Gemini.
- La cuota gratuita de Gemini es **por proyecto, no por IP**: el limitador por IP no basta. Por eso las llamadas se serializan y se espacian (`GEMINI_MIN_INTERVAL_MS`); si Gemini devuelve `429`, no se reintenta ni se prueba otro modelo, se enfría la cola global y se compone la semilla local al instante. La cabecera `X-Vibedom-Source: local` y `metadata.source` lo hacen visible sin romper la experiencia. Si se desactiva `SCAN_FALLBACK`, el servidor vuelve al `429` con `Retry-After` y un mensaje que, a partir de 10 minutos, habla de límite de uso y horas.
- La semilla de cada URL se guarda en memoria una hora (`SCAN_CACHE_TTL`): repetir un escaneo no vuelve a llamar a Gemini.
- Modelos: `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash`. No uses `gemini-2.x` (retirado para esta clave) ni `gemini-3.8-flash` (latencia inaceptable).

### Vertex AI (recomendado si hay facturación de Google Cloud)

La API key de AI Studio vive en un proyecto que puede quedarse en **nivel gratuito** aunque la cuenta de facturación tenga saldo: en ese caso los créditos no se descuentan y la cuota diaria se agota. **Vertex AI** se factura directamente contra el proyecto de Google Cloud, así que los créditos se aplican desde la primera llamada y las cuotas son por proyecto y región, no por una capa gratuita compartida.

Cambiar de motor no requiere tocar el frontend ni el motor de audio: el traductor detecta `VERTEX_PROJECT_ID` y usa Vertex; si no está, sigue usando `GEMINI_KEY`. El fallback local se mantiene igual.

**1. Requisitos en Google Cloud** (proyecto `vibedom`, el mismo de la facturación):

```bash
gcloud config set project vibedom
gcloud services enable aiplatform.googleapis.com

gcloud iam service-accounts create vibedom-vertex \
  --display-name="Vibedom Vertex"

gcloud projects add-iam-policy-binding vibedom \
  --member="serviceAccount:vibedom-vertex@vibedom.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud iam service-accounts keys create vibedom-vertex.json \
  --iam-account=vibedom-vertex@vibedom.iam.gserviceaccount.com
```

El rol `roles/aiplatform.user` es el mínimo para invocar modelos: la cuenta no puede tocar nada más del proyecto.

**2. Probar antes de desplegar:**

```bash
VERTEX_PROJECT_ID=vibedom \
VERTEX_LOCATION=europe-west4 \
VERTEX_SA_KEY_B64=$(base64 -w0 vibedom-vertex.json) \
npm run vertex:check
```

El script canjea el token, lista los modelos Gemini publicados en esa región y hace una llamada mínima a cada uno de `VERTEX_MODELS`. Si un modelo no existe en Vertex (los nombres no siempre coinciden con AI Studio), lo dice antes de romper producción: ajústalo con `VERTEX_MODELS`.

**3. Variables en Render:**

| Variable | Valor |
| --- | --- |
| `VERTEX_PROJECT_ID` | `vibedom` |
| `VERTEX_LOCATION` | `europe-west4` (o `global`) |
| `VERTEX_SA_KEY_B64` | salida de `base64 -w0 vibedom-vertex.json` |
| `VERTEX_MODELS` | opcional, p. ej. `gemini-3.5-flash,gemini-3.5-flash-lite` |

`GEMINI_KEY` puede quedarse mientras conviven ambos: si `VERTEX_PROJECT_ID` está definido, Vertex tiene prioridad. Para volver atrás, borra `VERTEX_PROJECT_ID`.

Notas de funcionamiento:

- El token de OAuth se firma con `node:crypto` y se cachea una hora; no hay dependencias nuevas. Un `401` descarta el token y reintenta una sola vez.
- Con Vertex las cuotas son mucho más altas, así que tras verificar se puede bajar `GEMINI_MIN_INTERVAL_MS` a 2000 y subir `GEMINI_MAX_WAIT_MS` a 12000.
- Vertex no tiene capa gratuita para Gemini Flash: cada escaneo consume crédito. Crea un presupuesto con alertas en Google Cloud antes de desplegar.
- El fichero de la clave **nunca** se commitea: se pasa en base64 por variable de entorno.

### Despliegue

La combinación recomendada es **GitHub Pages para la landing** y **Render para el analizador**:

- La landing y los presets cargan al instante desde Pages.
- Solo el escaneo viaja al backend de Render, que tiene las credenciales de Vertex AI (o la `GEMINI_KEY`) y acceso a Google Cloud.
- El servidor ya envía CORS y un limitador por IP (`SCAN_RATE_LIMIT`, 5/min por defecto) para proteger la clave.

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/germantes/vibedom)

1. Pulsa el botón, conecta GitHub y crea el servicio desde `render.yaml`.
2. Introduce `VERTEX_PROJECT_ID`, `VERTEX_LOCATION` y `VERTEX_SA_KEY_B64` (o, en su defecto, `GEMINI_KEY`) cuando Render los pida.
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
| `VERTEX_PROJECT_ID` | No | Activa Vertex AI en ese proyecto. Tiene prioridad sobre `GEMINI_KEY`. |
| `VERTEX_LOCATION` | No | Región de Vertex. Por defecto `europe-west4`; `global` usa el endpoint global. |
| `VERTEX_SA_KEY_B64` | Si se usa Vertex | JSON de la service account en base64 (`base64 -w0 clave.json`). |
| `VERTEX_SA_KEY_JSON` | No | La misma clave en crudo; cómodo en local, incómodo en Render. |
| `VERTEX_ACCESS_TOKEN` | No | Token de corta duración para pruebas (`gcloud auth print-access-token`). |
| `VERTEX_MODELS` | No | Cadena de modelos separada por comas para Vertex. |
| `GEMINI_KEY` | No | Clave de Google AI Studio (alternativa a Vertex). Sin Vertex ni key se usa el compositor local. |
| `PORT` | No | Render la inyecta; en local es 3000. |
| `SCAN_RATE_LIMIT` | No | Escaneos por minuto y por IP. Por defecto 5; `0` desactiva el límite. |
| `GEMINI_MIN_INTERVAL_MS` | No | Separación mínima entre llamadas reales a la IA. Por defecto 8000 ms (≈7,5/min). |
| `GEMINI_MAX_WAIT_MS` | No | Espera máxima de una petición en la cola global. Por defecto 25000 ms. |
| `GEMINI_QUEUE_LIMIT` | No | Peticiones que pueden esperar turno a la vez. Por defecto 10. |
| `SCAN_CACHE_TTL` | No | Segundos que se recuerda la semilla de una URL. Por defecto 3600; `0` desactiva la caché. |
| `SCAN_FALLBACK` | No | `0` desactiva la semilla local cuando la IA falla. Activada por defecto. |
| `SCAN_FALLBACK_COOLDOWN_S` | No | Si la IA ya está en enfriamiento, se salta la cola y se compone en local. Por defecto `0` (cualquier enfriamiento). |
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

**105 tests** con `node:test`, sin dependencias:

* escalas, acordes y conversión MIDI;
* validación de la semilla y presets reales;
* lógica generativa (Markov sin grados disminuidos, voice leading acotado, arpegio, scroll);
* scraper con HTML/CSS simulado (paleta, tipografía, colores con alfa, entidades, límites);
* traductor con `fetch` falso (reintentos, fallback de modelos, timeout, errores);
* compositor local determinista (contrato, idioma, fondo claro/oscuro, colores legibles y ausencia de señales);
* guard anti-SSRF (IPs privadas, redirects, DNS);
* servidor (rutas estáticas ES/EN y playground, `/api/scan`, health, 405/413/404/429, semilla local ante 429, path traversal y cancelación);
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

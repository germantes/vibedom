# Estado del Proyecto: vibedom (Web to Audio)

Documento de traspaso y contexto técnico para continuar el desarrollo.

---

## 1. Identidad y Repositorio

- **Cuenta de GitHub**: `germantes` (`German`, `gtorrestendero@gmail.com`).
- **Repositorio**: [`https://github.com/germantes/vibedom`](https://github.com/germantes/vibedom) (público, rama `main`).
- **Configuración local de Git**: el repositorio tiene configurado localmente `user.name`, `user.email` y un `credential.helper` propio para autenticar con el token de `germantes` sin colisionar con otras cuentas globales del sistema.
- **Demo pública**: [`https://vibedom.dev/`](https://vibedom.dev/) (dominio propio, HTTPS forzado). Sirve la UI completa, los presets y el escaneo real: las páginas estáticas llaman al backend de Render declarado en `<meta name="vibedom-api">`.

---

## 2. Visión del Producto y Reglas de Arquitectura

El objetivo es una herramienta que analiza la estética de cualquier web por URL y genera una **atmósfera sonora (soundscape) procedural, reactiva e infinita** con Tone.js en el navegador del visitante.

### Principios inviolables
1. **Cero coste de streaming/audio en backend**: el backend / LLM solo interviene una vez (escaneo) para producir un JSON estricto ("Semilla Sonora"). La música se sintetiza 100% en el cliente vía Web Audio API.
2. **Cero dependencias npm en backend**: servidor en `node:http`, scraper con `fetch` nativo + regex, sin librerías pesadas como cheerio o puppeteer para el servicio en producción.
3. **Lazy-loading estricto de Tone.js**: Tone.js (~150 KB) **nunca** se carga con la página inicial. Se descarga dinámicamente desde CDN solo cuando el usuario pulsa Reproducir o Escanear.
4. **Cumplimiento de Autoplay**: `Tone.start()` se dispara dentro de un gesto del usuario (`click` o `submit`). En el escaneo se precalienta el `AudioContext` dentro del gesto antes del `fetch`; si el navegador aun así lo bloquea, la UI pide pulsar Reproducir.
5. **Enfoque Ambient / Soundscapes**: música algorítmica generativa (pad envolvente, arpegio probabilístico con gravedad armónica y drone), no canciones con estribillos intrusivos.

---

## 3. Estado de Implementación

### ✅ FASE 1: Motor de Audio Procedural en Tone.js (COMPLETADA)

Implementado en ES Modules puros (`src/engine/`), sin build step:

- **`scales.js`**: notas, clases de altura, MIDI (`60 = C4`), 6 escalas modales y acordes diatónicos por terceras.
- **`seed.js`**: validador estricto del contrato; lanza `SeedError` con todos los problemas a la vez y recorta números fuera de rango (`RANGES`).
- **`generative.js`**: cadena de Markov sin tríadas disminuidas, voice leading por octavas, arpegio con pared elástica y gravedad armónica, mapeo de scroll.
- **`soundscape.js`**: pad `PolySynth` con `fat*`, drone, arpegio con delay y humanización, chorus → Freeverb → limiter → master. `latencyHint: "playback"` y `lookAhead: 0.3 s` para evitar dropouts.
- **`reactivity.js`**: scroll con amortiguación y caída; hover con antirrebote de 120 ms.
- **Presets**: `cyberpunk`, `editorial`, `indie-pastel`, validados por tests.

### ✅ FASE 2: Escáner de URL + Traductor con LLM (COMPLETADA)

Implementado en `src/backend/`:

- **`scraper.js`**:
  - Extrae título, meta descripción, encabezados, texto visible y señales de movimiento (`@keyframes`, `animation`, `transition`).
  - Analiza CSS inline, atributos `style` y hasta 4 hojas externas.
  - Detecta paleta, fondo dominante, contraste y luminancia; normaliza entidades HTML y colores con alfa.
  - Clasifica tipografías (`serif`, `sans-serif`, `monospace`, `display`).
  - Sigue redirecciones manualmente, valida cada salto y limita tamaño de descarga.
- **`url-guard.js`** (nuevo):
  - Bloquea loopback, rangos privados, link-local, CGNAT, multicast, TEST-NET y sufijos internos.
  - Resuelve DNS con timeout y caché (5 min) y bloquea hosts que resuelven a IPs privadas (incluido IPv4 mapeado en IPv6).
  - En desarrollo se puede desactivar con `VIBEDOM_ALLOW_PRIVATE=1`.
- **`translator.js`**:
  - Gemini o Vertex AI con `responseSchema` (structured output) y `thinkingLevel: "low"`.
  - **Cadena de modelos**: `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash`.
  - Timeout por intento (20 s), deadline total (50 s), 2 intentos por modelo, backoff exponencial + jitter.
  - Reintenta 404/408/429/5xx (Gemini devuelve 404 vacío esporádico por throttling).
  - Motor desde `src/backend/providers.js`: Vertex si hay `VERTEX_PROJECT_ID`, si no `GEMINI_KEY`; salida saneada con `normalizeSeed()`.
- **`server.js`**:
  - `node:http` nativo, `createVibedomServer()` / `startServer()` con dependencias inyectables para tests.
  - `POST /api/scan`, archivos estáticos, MIME correcto, CORS en la API.
  - Límite de body (16 KB), 413/405/404, bloqueo de dotfiles y path traversal.
  - Aborta scraper/traducción si el cliente desconecta.
- **Tests**: `scraper.test.js`, `translator.test.js`, `url-guard.test.js`, `server.test.js`.

Commits: `f64aec3` (Fase 2).

### ✅ FASE 3: Playground (COMPLETADA)

- **Panel de análisis** (`src/demo/analysis.js`):
  - 5 pasos con reloj real, barra de progreso asintótica y mensajes que distinguen scraper, Gemini y espera larga.
  - Estados `is-active`, `is-done`, `is-error`; botones Cancelar y Reintentar.
  - Temporizador de auto-ocultado cancelable (un escaneo nuevo no hereda el cierre del anterior).
- **Controles manuales** (`src/demo/controls.js`):
  - Sliders de tempo (40–140), brillo (80 Hz–12 kHz, escala logarítmica), espacialidad (reverb wet) y densidad del arpegio.
  - Mutan la semilla activa y aplican en caliente con `setBpm`, `setFilterFreq`, `setReverbWet` y `setArpDensity`.
  - La densidad se deshabilita si la semilla tiene el arpegio apagado.
  - Botón "Regenerar variación" (solo con audio sonando) que salta de grado y dispara un acorde nuevo.
- **Visualizador** (`src/demo/visualizer.js`):
  - Espectro de 48 barras con reparto exponencial de bins + osciloscopio, en canvas separados y medidos de forma independiente (responsive).
  - Colores sincronizados con la paleta escaneada; DPR limitado a 2.
- **UI y tema** (`index.html`, `src/demo/main.js`, `src/demo/demo.css`):
  - Paleta, tipografía, `theme-color` y `color-scheme` adoptados de la web analizada.
  - Muestras de paleta, origen, parámetros musicales traducidos al español, JSON crudo y pie.
  - Botón Escanear con spinner, formulario bloqueado durante el análisis y presets deshabilitados mientras hay una petición.
  - Responsive sin overflow en 390/768 px, foco visible, `prefers-reduced-motion`, `aria-live` y contraste calculado para el botón de acento.
  - `favicon.svg` propio.

#### Verificación realizada

- **58 → 85 tests** en verde (`npm test`), incluidos los de rutas estáticas ES/EN, health, rate limit, caché, detección de host estático, tema dinámico e idioma de la copia.
- E2E real en navegador con Playwright: `example.com` analizado en **~3,0 s**, autoplay correcto, tema claro aplicado, sin errores de consola.
- `stripe.com` verificado en backend en **~6,3 s**; SSRF a `localhost` devuelve 400.
- Flujo mockeado verificado: análisis visible, cancelación, error 502, reintento, sliders (incluidos extremos de brillo), regeneración, cambio de preset con audio activo, pausa, espectro con píxeles, responsive.
- Único aviso de consola restante: warning interno de Tone.js al disponer una voz dentro de un callback programado; no afecta al audio.

### ✅ FASE 3.5: Landing comercial bilingüe (COMPLETADA)

- **Rutas estáticas ES/EN**:
  - `/` y `/en/` para la landing.
  - `/playground/` y `/playground/en/` para el laboratorio.
  - Enlaces relativos y `hreflang`/canonical para funcionar en local y bajo la subruta de GitHub Pages.
- **i18n sin toggle JS** (`src/i18n.js`): diccionarios ES/EN, `t()` con interpolación y `applyI18n()` para `data-i18n`, `data-i18n-html` y atributos (`placeholder`, `aria-label`, `title`, `content`). El idioma se deduce de `<html lang>`, así que cada URL es compartible y rastreable.
- **Landing** (`index.html`, `en/index.html`, `src/landing/main.js`, `src/landing/landing.css`):
  - Hero con una acción principal (pegar URL y escuchar), demo de presets con audio, espectro y osciloscopio.
  - Panel de análisis reutilizado, con copia traducida; autoplay tras escaneo.
  - Secciones de cómo funciona, identidad sonora, privacidad, CTA al playground y FAQ.
  - Sin JSON ni sliders a la vista.
  - La semilla tiñe el acento, la paleta y el visualizador de la demo; los presets conservan la paleta de marca.
- **Playground movido** a `/playground/` y `/playground/en/` con barra superior, enlace de vuelta, selector de idioma y todos los textos traducidos (incluidos parámetros, estados y nombres de onda/escala).
- **Aviso de backend estático**: si la página se sirve en un host sin backend propio (GitHub Pages, dominio con API externa o `file:`), el escaneo no hace una petición inútil; muestra una explicación específica y sugiere `npm start` o los presets. También se añadió un mensaje para fallos de red del backend.
- **Backend externo opcional** (`src/api.js`): si la página declara `<meta name="vibedom-api" content="https://...">`, el escaneo usa ese origen incluso en GitHub Pages; si no, mantiene el aviso estático. Los cuatro HTML incluyen el meta vacío listo para rellenar.
- **Panel de análisis** (`src/demo/analysis.js`): acepta copia externa, manteniendo compatibilidad con los textos por defecto en español.
- **Controles** (`src/demo/controls.js`): acepta copia para el estado “arpegio off”.
- **`.nojekyll`** para que GitHub Pages sirva todos los archivos sin procesado de Jekyll.
- **SEO bilingüe**: canonical, `hreflang` ES/EN/x-default, `sitemap.xml` con alternates y `robots.txt` apuntando al sitemap.

#### Verificación de la landing

- Playwright (fuera del repo) sobre `localhost:3000`:
  - Landing ES/EN: títulos, `hreflang`, demo, 3 presets, audio, pausa, cambio de preset, espectro, paleta y responsive a 390 px sin overflow.
  - Escaneo mockeado: panel visible, semilla aplicada, autoplay, fuente y ocultado del panel.
  - Error de backend: panel en estado `is-error` y mensaje claro.
  - Playground ES/EN: rutas, barra superior, idioma, sliders, JSON, audio y pausa.
- Consola sin errores propios; solo el warning conocido de Tone.js y los 404 esperados del test de error.

### ✅ FASE 3.6: Despliegue del analizador (COMPLETADA)

- **`render.yaml`**: Blueprint de Render con runtime Node 22, plan free, health check en `/api/health`, `SCAN_RATE_LIMIT=5`, intervalo global de Gemini (`GEMINI_MIN_INTERVAL_MS=8000`, `GEMINI_MAX_WAIT_MS=25000`, `GEMINI_QUEUE_LIMIT=10`) y `GEMINI_KEY` como secreto solicitado al crear el servicio.
- **`GET /api/health`**: respuesta `{ ok: true, service: "vibedom", commit, engine }` sin caché, útil como health check, para despertar el plan gratuito y para comprobar qué commit está desplegado.
- **Rate limit por IP** (`src/backend/rate-limit.js`): ventana de 60 s, 5 escaneos/min por defecto, `SCAN_RATE_LIMIT=0` lo desactiva, usa la última IP de `X-Forwarded-For` (la que añade el proxy) y devuelve `429` + `Retry-After` antes de llamar a Gemini.
- **Backend externo configurable** (`src/api.js` + `<meta name="vibedom-api">`): permite que la landing de GitHub Pages escanee contra Render sin CORS adicional (el servidor ya envía `Access-Control-Allow-Origin: *`). Al cargar, la landing hace un `GET /api/health` para despertar el servicio.
- **Caché de semillas** (`src/backend/scan-cache.js`): guarda en memoria el resultado de cada URL una hora (`SCAN_CACHE_TTL`, `0` lo desactiva), con tope de 500 entradas y desalojo LRU. Repetir un escaneo responde al instante y no vuelve a llamar a Gemini; la cabecera `X-Vibedom-Cache` indica `HIT`/`MISS`.
- **Script de configuración** (`scripts/set-api.mjs`): `npm run set-api -- https://...` declara el backend externo en las páginas y valida la URL; `--clear` lo quita. Sustituye al `sed` del README.
- **Redespliegue**: GitHub Pages publica cada push a `main`; para Render hay un workflow (`.github/workflows/render-deploy.yml`) que lanza el Deploy Hook en cada push, porque el servicio creado como *Public Git Repository* no recibe webhooks y su *Auto-Deploy* queda decorativo. Con el secreto `RENDER_DEPLOY_HOOK` configurado en GitHub, el despliegue es automático; sin él, el workflow no hace nada.
- **Documentación**: botón *Deploy to Render*, variables de entorno, aviso de spin-down del plan free, comando `npm run set-api` y nota sobre dominio propio/canonical.

**Desplegado**: `https://vibedom.onrender.com` (servicio `vibedom`, plan free, Frankfurt, Node 22). Las seis páginas declaran ese origen en `<meta name="vibedom-api">` y GitHub Pages escanea contra él.

Verificación en producción (2026-10-26, commit `34d7512`):

- `GET /api/health` → `200 {"ok":true,"service":"vibedom"}` en 0,43 s, con `Access-Control-Allow-Origin: *` y `Cache-Control: no-store`.
- Preflight `OPTIONS /api/scan` → `204` con los encabezados CORS correctos.
- Escaneo real desde la landing publicada: `example.com` en **3,4 s** (`X-Vibedom-Cache: MISS`), autoplay correcto, enlace a la fuente y panel oculto.
- Segundo escaneo de la misma URL: **0,2 s** con `X-Vibedom-Cache: HIT`, sin volver a llamar a Gemini.
- Sin errores de consola propios en el flujo completo.

**Idioma de la copia**: resuelto. La landing y el playground envían `lang` (`es`/`en`) en `POST /api/scan`; el traductor lo añade al prompt y la caché usa una clave por idioma. Los presets tienen su copia ES/EN en `src/i18n.js`, así que también se traducen `detectedVibe` y `explanation` en el playground.

### ✅ Dominio propio `vibedom.dev` (COMPLETADO)

- **DNS en Name.com**: cuatro `A` de `@` a `185.199.108-111.153`; `CNAME www → germantes.github.io`. Los `AAAA` de GitHub quedaron sin configurar (opcional; el sitio funciona por IPv4). Sin *URL forwarding* ni registros de aparcamiento.
- **GitHub Pages**: `CNAME` en la raíz del repo, dominio `vibedom.dev` reconocido y certificado Let's Encrypt aprobado el 2026-10-26 para `vibedom.dev` y `www.vibedom.dev` (caduca el 2027-01-24). **Enforce HTTPS** activado.
- **`npm run set-domain -- https://vibedom.dev`**: reescribe 32 referencias en `canonical`, `og:url`, `hreflang`, JSON-LD, `sitemap.xml`, `robots.txt` y docs; genera `CNAME`.
- **Host estático en dominio propio** (`src/host-mode.js`): la landing ya no detecta Pages solo por `github.io`. Si el backend declarado vive en otro origen, el host es estático: se muestra el aviso de espera y `warmApi()` despierta Render. Cubre GitHub Pages, `vibedom.dev`, `file:` y cualquier host estático con API externa.
- **Verificación live** (commit `11c1ab4`): `/`, `/en/`, `/playground/` y `/playground/en/` en `200` con `canonical`, `lang` y `vibedom-api` correctos; `http://` y `www` redirigen a `https://vibedom.dev/`; certificado válido; `sitemap.xml` con 16 URLs del dominio nuevo; escaneo cross-origin en 0,4 s desde caché (`HIT`), autoplay, fuente y panel correctos; sin errores propios.

**Pendiente**: verificar el dominio en GitHub con el TXT `_github-pages-challenge-germantes.vibedom.dev` (protección contra *takeover*), y añadir los cuatro `AAAA` si se quiere soporte IPv6.

### ✅ FASE 3.7: Tema dinámico de la landing (COMPLETADA)

La landing deja de ser solo oscura: al escanear, la página entera adopta la paleta del sitio analizado, sin sacrificar legibilidad.

- **`src/landing/theme.js`**: utilidades puras de color — normalización de hex (3/4/6/8 dígitos), luminancia relativa, contraste WCAG, mezcla sRGB, `rgba()`, `textFor`, `onColorFor`, `accentFor` con mínimo configurable.
- **Corrección de contraste**: el texto escaneado se respeta solo si llega a 4.5:1; si no, se elige casi negro o casi blanco. El acento se conserva si supera 3:1 (formas/bordes) y se mezcla hacia blanco/negro hasta 4.5:1 (`--accent-ink`) cuando se usa como texto, teniendo en cuenta el tinte del badge. `--on-accent` elige el texto del botón por contraste.
- **Variables derivadas** (`landing.css`): `--muted`, `--line`, `--line-strong`, `--sheen-*`, `--accent-soft`, `--header-bg`, `--card-shadow`, `--glow-*` se calculan con `color-mix()` a partir de `--bg`, `--text` y `--accent`; el fondo transiciona con `background-color`.
- **Integración** (`src/landing/main.js`): `applyTheme(seed)` al escanear, `resetTheme()` al elegir preset; se actualizan `color-scheme`, `<meta name="theme-color">` y los colores del visualizador. El playground conserva su tema propio pero reutiliza `textFor`/`accentFor`/`onColorFor`.
- **Verificación**: escaneos mockeados de sitio claro (`#F7F3EC`), oscuro (`#0A0A0A`) y caso hostil blanco sobre blanco con acento pálido; preset devuelve la marca. Auditoría de contraste de 26 elementos: **26/26 en tema claro y 26/26 en oscuro**, incluido el texto del badge y los botones.

### ✅ FASE 3.8: Idioma de la copia (COMPLETADA)

- **`lang` en la API**: la landing y el playground envían `{ url, lang }` con el idioma de `<html lang>`. El servidor normaliza a `es`/`en` y lo pasa al traductor.
- **Prompt**: `detectedVibe` y `explanation` se escriben en el idioma de la página, no en el del sitio escaneado; los valores técnicos (escala, onda, BPM) no se traducen.
- **Caché por idioma**: la clave incluye `lang` para no devolver una semilla en español a una página EN. Repetir el escaneo en el mismo idioma sigue siendo `HIT`.
- **Presets traducidos**: `src/i18n.js` incluye `preset.*.vibe` y `preset.*.explanation` en ES/EN. La landing y el playground muestran la copia localizada sin tocar el JSON de la semilla (el panel técnico sigue mostrando el dato original).
- **Verificación local**: 85 tests y E2E que comprueba `lang=en`/`lang=es` en la petición, las etiquetas de presets en ambas rutas y el estado «Now playing» traducido.
- **Verificación en producción (2026-10-26, `c35f46a`)**: Render seguía sirviendo `f74bc9a` porque el auto-deploy no se disparó; se redesplegó con el Deploy Hook del servicio. `server.js` ya contiene `resolveLang` y `translator.js` `IDIOMA DE SALIDA`.
  - `lang=en` sobre `es.wikipedia.org/wiki/Guitarra` → «Dark encyclopedia guitar history» en **16,9 s** (`MISS`).
  - `lang=es` sobre la misma URL → «Enciclopedia oscura y sobria» en **18,6 s** (`MISS`); un primer intento chocó con cuota 429 de Gemini y el backend devolvió 502 tras agotar reintentos, pero el siguiente pasó.
  - Repetir ambos escaneos → `HIT` en **0,33 s** y **0,43 s**, con la copia de cada idioma.
  - E2E desde `https://vibedom.dev`: `/` y `/en/` envían `lang=es`/`lang=en`, muestran la semilla correspondiente y no registran errores de consola.
  - GitHub Pages construyó `c35f46a`; las cuatro rutas responden 200 y el `meta vibedom-api` apunta a Render.

### ✅ FASE 3.9: Open Graph y previews sociales (COMPLETADA)

- **Imágenes 1200×630** en `assets/og-es.png` y `assets/og-en.png`, generadas con Playwright fuera del repo (sin dependencias nuevas): fondo de marca, titular localizado, espectro y ficha de reproducción.
- **Metadatos sociales** en las dos landings: `og:image` absoluta con `type`, `width`, `height` y `alt`; `twitter:card=summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image` y `twitter:image:alt`.
- **Playground**: añadidos canonical, `hreflang` ES/EN/x-default y el mismo bloque Open Graph/Twitter, con la imagen de su idioma.
- **Verificación**: script `check-og.mjs` contra el servidor local, **28/28 PASS** (metadatos, canonical, URL absoluta y PNG real de 1200×630 en las cuatro rutas); 85 tests y E2E de SEO sin regresiones.

### ✅ FASE 3.10: Cuota global de Gemini y errores amables (COMPLETADA)

- **Causa del fallo**: la cuota gratuita de Gemini es **por proyecto, no por IP**. El limitador por IP no protegía a dos visitantes distintos y el traductor trataba el `429` como reintentable: hasta 6 llamadas por escaneo (3 modelos × 2 intentos), así que la segunda petición seguida agotaba el cupo y acababa en un `502` con el mensaje crudo de Google.
- **`src/backend/gemini-limiter.js`**: cola global que serializa las llamadas reales a Gemini, las espacia `GEMINI_MIN_INTERVAL_MS` (8 s ≈ 7,5/min) y limita la espera (`GEMINI_MAX_WAIT_MS`, 25 s) y el tamaño de la cola (`GEMINI_QUEUE_LIMIT`, 10). Si no hay hueco, lanza `RATE_LIMITED` con `retryAfter`.
- **429 no reintentable** (`src/backend/translator.js`): se detiene la cadena de modelos, se lee `Retry-After` o `error.details[].retryDelay`, se enfría la cola global y se propaga `{ code: "RATE_LIMITED", retryAfter }`.
- **Respuesta HTTP**: el servidor devuelve `429` con `Retry-After`, `code` y un mensaje localizado ES/EN; los fallos restantes devuelven `502` con `{ code: "ANALYSIS_FAILED" }` y un mensaje genérico, sin filtrar detalles técnicos. La landing y el playground traducen el código con `status.rateLimited` / `playground.status.rateLimited`. Si la espera supera los 10 minutos (cupo diario agotado) no se muestra «espera 52 391 s»: se explica que se alcanzó el límite de uso, se redondea a horas y se sugiere un preset.
- **Límites**: `SCAN_RATE_LIMIT` baja de 10 a 5 por IP; `render.yaml` declara también las tres variables del limitador global.
- **`GET /api/health`**: incluye `commit` (`RENDER_GIT_COMMIT`) para comprobar qué versión está desplegada.
- **Verificación local**: **96 tests** en verde (nuevos tests del limitador, del 429 del traductor y del contrato HTTP), E2E de landing/playground sin regresiones y simulación de `429` en las cuatro rutas con el mensaje correcto en cada idioma (12 s, 5 min y 15 h).
- **Verificación live** (2026-10-27, backend `f7f9848`): dos escaneos reales consecutivos con URLs distintas → `200` en **4,0 s** y `200` en **15,7 s** (`X-Vibedom-Cache: MISS` en ambos). El segundo esperó la cola global en vez de recibir un `429` o un `502`. Un `429` real de cupo diario devolvió `retryAfter: 52391`; el cliente ya lo presenta como «límite de uso, se renueva en unas 15 h».
- **Pendiente**: Render sigue sin aplicar el auto-deploy; `1bb5b2c` (mensaje largo también en el servidor) está en GitHub y Pages, pero el backend requiere otro *Manual Deploy*. La UI ya muestra el mensaje correcto porque formatea el `retryAfter` en el cliente.
- **Superado parcialmente por 3.11**: con `SCAN_FALLBACK` activo (por defecto), un 429 ya no llega al usuario: se responde con una semilla local. El `429` amable se conserva para `SCAN_FALLBACK=0` y para el rate limit por IP.

### ✅ FASE 3.11: Semilla local cuando Gemini no está disponible (COMPLETADA)

- **Problema**: aunque el 429 ya era amable, el cupo diario agotado dejaba la demo sin escaneos durante horas. La segunda visita no podía hacer nada.
- **`src/backend/local-seed.js`**: compositor determinista sin IA. Traduce fondo, saturación, tipografía, movimiento y paleta a una Semilla Sonora válida con las mismas reglas del prompt. La misma web con las mismas señales produce la misma música; el idioma solo cambia `detectedVibe` y `explanation`.
- **Servidor**: si el scrape ya obtuvo señales y Gemini devuelve `429`, `ANALYSIS_FAILED` o falla la red, responde `200` con `metadata.source: "local"` y `X-Vibedom-Source: local`. La semilla local no se cachea, así que el primer escaneo con cuota disponible vuelve a usar Gemini.
- **Enfriamiento**: si el limitador ya conoce un `429` previo, el servidor ni siquiera espera la cola (`SCAN_FALLBACK_COOLDOWN_S=0` por defecto). El primer 429 tarda lo que tarde Gemini; los siguientes son inmediatos.
- **UI**: la línea de origen muestra «análisis local» y su `title` explica que la IA no estaba disponible; el estado de reproducción lo indica sin errores técnicos. Funciona en ES/EN y en landing/playground.
- **Control**: `SCAN_FALLBACK=0` recupera el comportamiento anterior (429 amable con `Retry-After`). Si el scraper no puede cargar la web, se mantiene el `502` genérico: no se inventa una semilla sin señales.
- **Verificación**: **105 tests** en verde (compositor local, determinismo, contrato, contraste, claro/oscuro, idioma, 429 cubierto, enfriamiento sin llamar a Gemini y modo sin fallback).

### ✅ FASE 3.12: Vertex AI como motor facturable (COMPLETADA)

- **Motivo**: la API key de AI Studio puede vivir en un proyecto en **nivel gratuito** aunque la cuenta de facturación tenga crédito. En ese caso los 50 $ no se descuentan, la cuota diaria se agota y los escaneos caen al compositor local. Vertex AI se factura contra el proyecto de Google Cloud, así que los créditos se aplican desde la primera llamada.
- **`src/backend/vertex-auth.js`**: service account → JWT RS256 (`node:crypto`) → access token de OAuth2, cacheado una hora con renovación tras un `401`. Sin dependencias npm.
- **`src/backend/providers.js`**: dos proveedores con el mismo contrato (`prepare`, `models`, `systemInstructionField`, `refresh`). `VERTEX_PROJECT_ID` tiene prioridad; si no existe, se usa `GEMINI_KEY`; sin ninguna, el servidor compone en local. `resolveEngine()` alimenta `engine` en `/api/health` y la cabecera `X-Vibedom-Source` (`vertex` / `gemini` / `local`).
- **`src/backend/translator.js`**: la cadena de modelos, el 429, el `Retry-After` y la semilla local siguen igual; solo cambia la URL y la autenticación. Vertex construye `https://{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:generateContent` y usa `systemInstruction` en camelCase.
- **`scripts/vertex-check.mjs`** (`npm run vertex:check`): canjea el token, lista el catálogo publicado en la región y hace una llamada mínima a cada modelo de `VERTEX_MODELS`; detecta nombres de modelo inexistentes antes de desplegar. Si no hay service account usa el proyecto activo y el token de `gcloud`, y si no hay ninguno de los dos prueba nombres alternativos de modelo y el endpoint global.
- **Región**: por defecto `global`. Los modelos `gemini-3.5-flash`, `gemini-3.5-flash-lite` y `gemini-3.6-flash` devuelven `404` en `europe-west4` y responden en el endpoint global, así que `DEFAULT_VERTEX_LOCATION` y `render.yaml` usan `global`.
- **`role: "user"` obligatorio**: Vertex rechaza `contents` sin rol (`400 Please use a valid role: user, model`); la API key lo asumía y por eso el mismo body funcionaba con Gemini y no con Vertex.
- **`.env` en local**: `src/backend/dotenv.js` carga el fichero solo al arrancar el servidor como proceso principal y en los scripts, nunca al importar módulos (los tests no heredan credenciales).
- **Límites**: con Vertex la facturación es por proyecto y las cuotas son mucho más altas, así que `GEMINI_MIN_INTERVAL_MS=2000` y `GEMINI_MAX_WAIT_MS=12000` (antes 8000/25000).
- **`src/backend/scan-budget.js`**: tope diario de escaneos facturables, en memoria y con reinicio a medianoche UTC. `SCAN_DAILY_LIMIT` (200/día) y `SCAN_IP_DAILY_LIMIT` (30/día) cubren el caso de muchas IPs distintas, que el límite por minuto no frena. Al agotarse, el servidor responde con la semilla local sin llamar a Vertex; con `SCAN_FALLBACK=0` devuelve el 429 amable. La caché y los escaneos locales no consumen cupo. `/api/health` expone `budget` y `engine`. El contador se pierde al reiniciar el proceso (Render free duerme por inactividad), así que es una barrera de primera línea: el presupuesto con alertas de Google Cloud sigue siendo obligatorio.
- **Verificación local**: escaneo real de `https://example.com` → `200` en **3,3 s**, `X-Vibedom-Source: vertex`, semilla de IA («Minimalismo crudo y documental», C major 65 BPM) y `tokens in=1929 out=364`. Con `SCAN_DAILY_LIMIT=1`, el segundo escaneo devolvió `X-Vibedom-Source: local` sin llamar a Vertex y `budget.usedToday` quedó en 1. **122 tests** en verde (10 de Vertex + 5 del presupuesto + integración).
- **Facturación**: el proyecto `gen-lang-client-0008536547` está vinculado a la cuenta de facturación educativa de los 50 USD y el presupuesto de 5 USD/mes para Vertex tiene avisos en 2,50 / 4,50 / 5 USD. Los avisos no bloquean el gasto: el tope de 200 escaneos/día sigue siendo la barrera real. La clave expuesta en el chat (`931aaefa…`) ya no canjea tokens; la única activa es la `794f3d…` que usa la app. Queda confirmar en Billing que el consumo empieza a descontar de los 50 USD (puede tardar horas en reflejarse).

### ✅ FASE 4: Widget embebible (COMPLETADA)

- **`widget.js`** (**4.832 bytes**): script clásico sin dependencias. Lee la semilla de `data-seed` (base64 UTF-8), monta el botón flotante en **Shadow DOM** (`:host{all:initial}`) y usa `uiTheme` con contraste mínimo para que siga visible. Respeta `prefers-reduced-motion`, expone `aria-pressed` y acepta `data-label`; sin él, elige ES/EN según `<html lang>`. No descarga nada más hasta el clic.
- **`widget-player.js`**: se importa desde `widget.js` solo al primer clic. Descarga Tone.js del CDN, configura el contexto dentro del gesto y crea el soundscape con la semilla incrustada. Sin backend, sin IA y sin coste por visitante.
- **`src/embed.js`**: `encodeSeed()` (JSON → UTF-8 → base64, seguro dentro de un atributo) y `buildWidgetSnippet()`. También concentra el enlace compartido (`encodeShareToken`, `decodeShareToken`, `buildShareHash` y `readShareHash`). El snippet apunta a `https://vibedom.dev`; en local, a `location.origin`.
- **Playground ES/EN**: tarjeta «Tu widget embebible» con el snippet actualizado en caliente con los sliders y botón de copia (con fallback a `execCommand`).
- **Servidor**: los estáticos responden con `Access-Control-Allow-Origin: *` para que `widget.js`, sus módulos y el motor se puedan importar desde otro dominio.
- **Verificación**: **134 tests** en verde (tamaño < 5 KB, Shadow DOM, carga diferida, round-trip base64 con acentos/emojis y snippet sin `</script>` inyectado) y E2E con Chromium headless: el botón aparece, `widget-player.js` y Tone.js se cargan solo tras el clic, arranca y pausa; el snippet de 1.217 bytes se genera desde el playground y se copia al portapapeles sin errores 404.

### ✅ FASE 4.1: Enlace compartido de la Semilla (COMPLETADA)

- **Formato**: la semilla viaja en el fragmento `#seed=<base64url>` (~1,4 KB para un preset). El fragmento no se envía al servidor, así que no hay backend, base de datos ni coste por compartir.
- **`src/embed.js`**: `encodeShareToken()` / `decodeShareToken()` (UTF-8, base64url sin `+`, `/` ni `=`), `buildShareHash()` y `readShareHash()`.
- **Playground ES/EN**: la URL se sincroniza en caliente con `history.replaceState()` al cargar un preset, escanear o mover un slider. El botón **Copiar enlace** copia la URL con fallback a `execCommand` y muestra «Enlace copiado» / «Link copied».
- **Carga segura**: el JSON del fragmento se valida con `normalizeSeed()` antes de tocar el motor o el DOM. Un enlace corrupto o fuera de contrato carga el preset por defecto y muestra «El enlace compartido no era válido».
- **Sin autoplay**: al abrir un enlace compartido se muestra la semilla y se pide pulsar Reproducir, respetando la política de gestos del navegador.
- **Verificación**: **134 tests** (round-trip, base64url, fragmentos sin semilla y tokens corruptos) y E2E con Chromium: slider a 100 BPM → `#seed` cambia → «Copiar enlace» → otra pestaña restaura 100 BPM **sin ninguna petición a `/api/scan`**; enlace inválido → preset con aviso; ES/EN correctos y sin 404 ni errores JS.

### ✅ FASE 4.2: Página SEO «what does my website sound like» (COMPLETADA)

- **Rutas**: `/que-suena-mi-web/` (ES) y `/en/what-does-my-website-sound-like/` (EN). Cada una tiene su propio canonical, `hreflang` ES/EN/x-default, Open Graph/Twitter y `lastmod` en el sitemap.
- **Contenido**: respuesta larga y distinta de la landing —cómo se traduce el diseño en música, seis señales visuales, qué lee el analizador, casos minimalistas y FAQ específica— con enlaces internos a la landing y al playground.
- **JSON-LD**: `@graph` con `WebApplication`, `BreadcrumbList` y `FAQPage` (8 preguntas). Las respuestas visibles coinciden con los datos estructurados.
- **Reutilización**: ambas páginas cargan `src/landing/main.js` y `landing.css`, así que el formulario, los presets, el tema dinámico y el audio funcionan sin duplicar lógica. Se añadieron estilos para prosa, tarjetas de mapeo y listas de transparencia.
- **Enlaces internos**: pies de las landings ES/EN y de los playgrounds, además de la propia página SEO hacia el otro idioma, la landing y el playground.
- **Verificación**: **141 tests** en verde (nuevas pruebas de rutas, canonical/hreflang, JSON-LD, coincidencia FAQ visible/datos estructurados, enlaces locales y sitemap) y E2E con Chromium: ES/EN sin 404 ni errores JS, 3 presets y play/pausa, escaneo simulado con tema aplicado y responsive a 390 px sin overflow.

### ✅ FASE 4.3: Auto-deploy de Render vía Deploy Hook (COMPLETADA)

- **Síntoma**: pushes a `main` actualizan GitHub Pages pero Render sigue en un commit antiguo (comprobable en `GET /api/health` → `commit`), aunque el panel muestre *Auto-Deploy: On Commit* y rama `main`.
- **Causa**: el servicio se creó como **Public Git Repository**, no con la GitHub App. Evidencia: `GET /repos/germantes/vibedom/hooks` devuelve una lista vacía y el commit `0eab872` no tiene ningún check/status de Render (solo los de Pages). Render solo auto-despliega servicios con proveedor Git conectado; la región Frankfurt es irrelevante.
- **Solución**: `.github/workflows/render-deploy.yml` hace `POST` al Deploy Hook del servicio en cada push a `main` (y permite `workflow_dispatch`). Requiere el secreto `RENDER_DEPLOY_HOOK` en GitHub → Settings → Secrets and variables → Actions; sin él el workflow no hace nada y no falla, así que no introduce ruido.
- **Verificación**: con `RENDER_DEPLOY_HOOK` añadido en GitHub, el workflow desplegó `c5936cf` y `/api/health` pasó de `f1b2202` a `c5936cf`; `/que-suena-mi-web/`, `/en/what-does-my-website-sound-like/`, `/playground/`, `/playground/en/`, `/widget.js` y `/widget-player.js` responden `200` en `onrender.com`, sin 404 ni errores JS, y el playground vuelve a mostrar el botón de compartir.

### ✅ FASE 4.4: Vista previa al compartir y CI de tests (COMPLETADA)

- **Problema**: al pegar un enlace con `#seed=...` en X, WhatsApp o Slack, la tarjeta mostraba la OG genérica de la landing. Los rastreadores no ven el fragmento, así que la semilla no podía influir en la previsualización.
- **Vista previa** (`src/backend/share-preview.js`): `GET /s/<token>` devuelve HTML con `og:title` (host + vibe detectada), `og:description` (BPM, tonalidad y onda) y `og:image`, más `noindex, follow`; redirige al playground con `#seed` mediante `<meta refresh>` y `location.replace`, y funciona sin JavaScript. `?l=en` mantiene el idioma.
- **Imagen** (`src/backend/share-image.js`): `GET /s/<token>.png` genera al vuelo una tarjeta 1200×630 con el fondo y el acento de `uiTheme`, tres muestras de color y una onda cuya amplitud sale del BPM y la densidad del arpegio. PNG a mano con `node:zlib` y CRC32: cero dependencias, cacheado como inmutable.
- **Enlaces**: `buildShareLink()` en `src/embed.js`; el playground copia la vista previa cuando hay API y cae al `#seed` local en un host estático sin backend. Un token corrupto responde `400` con enlace al playground.
- **CI** (`.github/workflows/test.yml`): `npm test` en cada push y PR; sin `npm install` porque el proyecto no tiene dependencias.
- **Verificación**: **146 tests** (vista previa, redirección ES/EN, token corrupto, cabecera IHDR 1200×630, muestras de color idénticas a `uiTheme`, `buildShareLink` y tamaño del enlace real) y comprobación del PNG decodificado píxel a píxel.
- **Producción (2026-10-28, `53f1e1e`)**: el workflow `tests` pasa en 10 s y `render` despliega en 6 s; `/api/health` confirma el commit. Un enlace real devuelve `200` con OG completo, la imagen pesa 25 KB (1200×630) y el `<meta refresh>` apunta a `https://vibedom.dev/playground/#seed=…` (`/en/` con `?l=en`). El destino existe: `/playground/` y `/playground/en/` responden `200` en el dominio propio.

### ✅ FASE 4.5: Escaneo fiable de webs que bloquean al bot (COMPLETADA)

- **Síntoma reportado**: `https://estebantorressagra.blogspot.com/` devolvía `502` en producción (a veces tras ~60 s) mientras en local funcionaba.
- **Causa 1 — bloqueo de IP**: Google responde al bot de Render con `302 → www.google.com` y luego `HTTP 429`; con el UA de un navegador, igual. La IP del datacenter está bloqueada aunque el mismo UA funcione en local.
- **Causa 2 — regex cuadrático (la grave)**: cuando Google sí servía la página, `findBackgroundColor()` usaba `([^{}]+)\{([^{}]*)\}`. Blogger añade ~293 KB de atributos `style=` sin llaves al final del CSS: los 349 KB tardaban **61 s** en Node, bloqueaban el event loop (la traza se corta en `css 349KB`) y Render reiniciaba la instancia por health check fallido, devolviendo `502` sin cuerpo a mitad del escaneo.
- **Arreglo del regex**: recorrido con `indexOf("{")`/`indexOf("}")` y selector más interno para `@media`; mismo resultado en **18 ms** y test de regresión con un tramo largo sin llaves.
- **Arreglo del bloqueo**: reintento único con cabeceras de navegador solo ante `403/429/5xx`; presupuesto de 20 s para el scrape; 30 s para la IA; watchdog de 45 s por petición que aborta lo que quede en vuelo. Si nada se puede leer, `200` con semilla local (`metadata.source=local`, `metadata.unreadable=true`) y explicación honesta («esta web bloquea la lectura automática»), nunca un `502`; el rastro viaja en `X-Vibedom-Diagnostic`.
- **Diagnóstico**: `src/backend/events.js` persiste en `/tmp` los saltos del scraper (host, estado, KB, ms) y el ciclo de cada escaneo; `GET /api/diagnostics` los expone con `uptimeS` y RSS. Sin rutas ni parámetros de las webs escaneadas. Los cuerpos descartados (redirecciones, 4xx) se cancelan para no dejar sockets abiertos.
- **Verificación (2026-10-31, `4b3093e`)**: 153 tests. En producción el blog responde `200` en 5,5 s con `engine: vertex` y la paleta real (`#006600` / `#4d90fe`), luego `HIT` en caché en 0,7 s y 0,16 s; la instancia sigue sana (`uptime` creciente) y la traza muestra `css 349KB → señales 8 colores 6 fuentes` en 200 ms.

### 🔎 Strudel frente a Tone.js (evaluado, no adoptado)

Se revisó Strudel como alternativa al motor actual. Es un port JavaScript de Tidal Cycles: su fuerte son los **patrones rítmicos y el live coding sobre samples**, no la síntesis procedural sin audio pregrabado. Adoptarlo implicaría reescribir la Semilla Sonora y el motor, añadir muestras (o cargar su banco) y cumplir la **AGPL-3.0** en un producto web. Se mantiene Tone.js; una prueba A/B con Strudel queda como experimento externo, no como dependencia del repo.

---

## 4. Lo que queda por hacer (Roadmap)

### Mejoras opcionales
- Verificar `vibedom.dev` en GitHub Pages con el TXT `_github-pages-challenge-germantes` (protección contra *takeover*) y añadir los `AAAA` de GitHub para IPv6.
- Alta en Search Console y envío del sitemap (las páginas SEO ya están publicadas).
- Historial de escaneos recientes (localStorage).
- Exportar/importar Semilla Sonora.
- Tests de UI automatizados estables (los actuales son verificación manual con Playwright en `/tmp`).

---

## 5. Estructura de Archivos Actual

```
.
├── .env                                       # VERTEX_* o GEMINI_KEY (GITIGNORADO)
├── .gitignore                                 # node_modules, .DS_Store, .env, claves
├── .nojekyll                                  # GitHub Pages sin Jekyll
├── sitemap.xml                                # Sitemap bilingüe con hreflang
├── robots.txt                                 # Crawl abierto + sitemap
├── render.yaml                                # Blueprint de Render
├── LICENSE                                    # Licencia MIT (German)
├── README.md                                  # Documentación general y demo
├── especificaciones_del_proyecto_web_to_audio.md # Spec funcional y técnico
├── ESTADO_DEL_PROYECTO.md                     # Este documento
├── index.html                                 # Landing ES
├── en/
│   ├── index.html                             # Landing EN
│   └── what-does-my-website-sound-like/
│       └── index.html                         # Página SEO EN
├── que-suena-mi-web/
│   └── index.html                             # Página SEO ES
├── playground/
│   ├── index.html                             # Playground ES
│   └── en/
│       └── index.html                         # Playground EN
├── assets/
│   ├── og-es.png                              # Open Graph ES 1200×630
│   └── og-en.png                              # Open Graph EN 1200×630
├── favicon.svg                                # Icono de la demo
├── widget.js                                  # Botón flotante < 5 KB en Shadow DOM
├── widget-player.js                           # Motor + Tone.js bajo demanda
├── package.json                               # Scripts (start, dev, test)
├── presets/                                   # Semillas de prueba
│   ├── cyberpunk.json
│   ├── editorial.json
│   └── indie-pastel.json
├── src/
│   ├── i18n.js                                # Diccionarios ES/EN y applyI18n
│   ├── api.js                                 # /api/scan y backend externo
│   ├── embed.js                               # Semilla base64, enlace compartido y snippet
│   ├── host-mode.js                           # Detección de host estático
│   ├── backend/
│   │   ├── scraper.js                         # Extracción HTML/CSS sin dependencias
│   │   ├── server.js                          # node:http + API /api/scan + health + /s/
│   │   ├── share-preview.js                   # Open Graph de un enlace compartido
│   │   ├── share-image.js                     # tarjeta PNG 1200×630 desde la semilla
│   │   ├── rate-limit.js                      # Cuota de escaneos por IP
│   │   ├── scan-cache.js                      # Caché en memoria de semillas
│   │   ├── scan-budget.js                     # Tope diario de escaneos facturables
│   │   ├── local-seed.js                      # Compositor determinista sin IA
│   │   ├── events.js                          # Traza de escaneos para diagnosticar caídas
│   │   ├── translator.js                      # IA con retries/fallback/timeout
│   │   ├── providers.js                       # Vertex AI o Gemini API según entorno
│   │   ├── vertex-auth.js                     # JWT de service account + token OAuth
│   │   └── url-guard.js                       # Validación anti-SSRF
│   ├── landing/
│   │   ├── landing.css                        # Tema comercial de la landing
│   │   ├── main.js                            # Demo, escaneo y audio de la landing
│   │   └── theme.js                           # Contraste WCAG y tema dinámico
│   ├── demo/
│   │   ├── analysis.js                        # Panel de progreso del análisis
│   │   ├── controls.js                        # Sliders y mapeo logarítmico
│   │   ├── demo.css                           # Estilos basados en la semilla
│   │   ├── main.js                            # Orquestación del playground
│   │   └── visualizer.js                      # Espectro + osciloscopio
│   └── engine/
│       ├── generative.js                      # Markov, voice leading, arpegio
│       ├── reactivity.js                      # Scroll y hover
│       ├── scales.js                          # Teoría musical
│       ├── seed.js                            # Validación del contrato
│       └── soundscape.js                      # Motor Tone.js
└── test/
    ├── embed.test.js
    ├── gemini-limiter.test.js
    ├── generative.test.js
    ├── host-mode.test.js
    ├── local-seed.test.js
    ├── rate-limit.test.js
    ├── scales.test.js
    ├── scan-budget.test.js
    ├── scan-cache.test.js
    ├── scraper.test.js
    ├── seed.test.js
    ├── seo.test.js
    ├── server.test.js
    ├── theme.test.js
    ├── translator.test.js
    ├── url-guard.test.js
    ├── vertex.test.js
    └── widget.test.js
```

---

## 6. Comandos para Ejecutar

```bash
# Tests unitarios (sin dependencias externas)
npm test

# Servidor completo (estáticos + API /api/scan en el puerto 3000)
npm start

# Modo desarrollo con reinicio automático
npm run dev
```

### Notas para el siguiente agente

- Crea `.env` en la raíz con las variables `VERTEX_*` (recomendado) o `GEMINI_KEY=...` para escanear. Está gitignorado y el servidor estático lo bloquea.
- Mantén `gemini-3.5-flash` como preferido. En Vertex confirma el nombre exacto con `npm run vertex:check` y ajústalo con `VERTEX_MODELS`. No uses `gemini-2.x` (retirado para esta clave) ni `gemini-3.8-flash` (latencia inaceptable).
- Respeta la regla de cero dependencias npm en backend y el lazy-loading de Tone.js.
- **Widget**: `widget.js` debe seguir por debajo de 5 KB y sin dependencias; no importes Tone.js ahí. El motor se carga en `widget-player.js` y el snippet se genera con `src/embed.js`. Los estáticos necesitan `Access-Control-Allow-Origin: *` para que se importen desde webs de terceros.
- **Enlace compartido**: vive solo en `location.hash` (`#seed=`); no lo mandes al backend ni lo guardes en la caché. Valida siempre con `normalizeSeed()` antes de cargarlo. Si cambias el formato, mantén la lectura de enlaces antiguos o falla al preset con aviso.
- **Al publicar**: el snippet usa `https://vibedom.dev/widget.js`. Tras desplegar, comprueba que `/widget.js` y `/widget-player.js` responden tanto en GitHub Pages como en Render.
- Si cambias el backend, reinicia `npm start` (el proceso en segundo plano no recarga solo).
- El motor no debe importar Tone.js: se inyecta desde `main.js` para conservar el lazy-loading.
- La verificación con Playwright se hizo con `playwright-core` instalado fuera del repo (`/tmp/opencode`) usando el Chromium cacheado; no añadir Playwright al `package.json` sin decisión explícita.
- **Bilingüe**: las rutas son estáticas (`/`, `/en/`, `/que-suena-mi-web/`, `/en/what-does-my-website-sound-like/`, `/playground/`, `/playground/en/`). No convertir la elección de idioma en un toggle JS: rompería SEO, enlaces compartidos y el render sin JavaScript. Para añadir textos, edita `src/i18n.js` y usa `data-i18n` en el HTML; el contenido único de la página SEO va directo en su HTML para que los buscadores lo lean sin ejecutar JS.
- **Landing vs playground**: la landing no debe mostrar JSON ni sliders. La demo de la landing reutiliza `analysis.js`, `visualizer.js` y el motor; si cambias su API, revisa `src/landing/main.js` y `src/demo/main.js`.
- **CSS de terceros**: no vuelvas a recorrer bloques con `([^{}]+)\{([^{}]*)\}`. Los atributos `style=` de Blogger son cientos de KB sin llaves y ese patrón es cuadrático (61 s con 349 KB). `findBackgroundColor()` usa `indexOf` y hay un test que falla si vuelve a degradarse.
- **502 sin cuerpo tras ~60 s**: casi siempre es el proceso bloqueado o caído, no un timeout de red. Mira `GET /api/diagnostics` (`uptimeS`, últimas líneas de la traza); si `uptimeS` es pequeño, Render reinició la instancia. `/tmp/vibedom-events.log` sobrevive al reinicio del proceso, no al despliegue.
- **Render free**: duerme a los 15 min de inactividad. Para la demo se puede usar un monitor externo (cron-job.org o UptimeRobot) con `GET /api/health` cada 10 min; recuerda que el plan free tiene 750 h/mes y 24/7 consume casi todas, así que valora limitar la franja horaria.
- **GitHub Pages es estático**: el escaneo no funcionará online hasta desplegar el backend. El código detecta `github.io` y muestra un aviso específico; no lo elimines pensando que es un bug.
- El servidor de desarrollo puede seguir sirviendo archivos actualizados sin reinicio; si cambias código del backend (`src/backend/`), reinicia `npm start`.

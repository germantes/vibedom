# Estado del Proyecto: vibedom (Web to Audio)

Documento de traspaso y contexto técnico para continuar el desarrollo.

---

## 1. Identidad y Repositorio

- **Cuenta de GitHub**: `germantes` (`German`, `gtorrestendero@gmail.com`).
- **Repositorio**: [`https://github.com/germantes/vibedom`](https://github.com/germantes/vibedom) (público, rama `main`).
- **Configuración local de Git**: el repositorio tiene configurado localmente `user.name`, `user.email` y un `credential.helper` propio para autenticar con el token de `germantes` sin colisionar con otras cuentas globales del sistema.
- **Demo estática en GitHub Pages**: [`https://germantes.github.io/vibedom/`](https://germantes.github.io/vibedom/). Sirve la UI completa y los presets, pero el escaneo de URLs requiere el backend (`npm start`) porque Pages es solo estático.

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
  - Gemini con `responseSchema` (structured output) y `thinkingLevel: "low"`.
  - **Cadena de modelos**: `gemini-3.5-flash` → `gemini-3.5-flash-lite` → `gemini-3.6-flash`.
  - Timeout por intento (20 s), deadline total (50 s), 2 intentos por modelo, backoff exponencial + jitter.
  - Reintenta 404/408/429/5xx (Gemini devuelve 404 vacío esporádico por throttling).
  - Clave desde `GEMINI_KEY` o `.env`; salida saneada con `normalizeSeed()`.
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

- **52 tests** en verde (`npm test`).
- E2E real en navegador con Playwright: `example.com` analizado en **~3,0 s**, autoplay correcto, tema claro aplicado, sin errores de consola.
- `stripe.com` verificado en backend en **~6,3 s**; SSRF a `localhost` devuelve 400.
- Flujo mockeado verificado: análisis visible, cancelación, error 502, reintento, sliders (incluidos extremos de brillo), regeneración, cambio de preset con audio activo, pausa, espectro con píxeles, responsive.
- Único aviso de consola restante: warning interno de Tone.js al disponer una voz dentro de un callback programado; no afecta al audio.

---

## 4. Lo que queda por hacer (Roadmap)

### Fase 4: Generador de Snippet Embebible y Componente Framer / Webflow

- **Micro-widget (< 5 KB iniciales)**:
  - Script vanilla JS autocontenido en **Shadow DOM**.
  - Semilla Sonora inyectada como objeto plano.
  - Botón flotante minimalista (onda animada SVG/CSS) con la paleta de `uiTheme`.
  - Carga diferida de Tone.js solo al hacer clic.
- **Generador de código en el Playground**:
  - Bloque "Copia tu snippet" con el `<script>` listo para Webflow, Framer o HTML clásico.
  - El snippet debe usar `location.origin` (o la URL de despliegue configurada) para apuntar al widget; no hardcodear `vibedom.com` mientras no exista ese dominio.
  - Componente nativo para Framer (`framer-code-components`).

### Mejoras opcionales
- Historial de escaneos recientes (localStorage) y compartir semilla por URL.
- Exportar/importar Semilla Sonora.
- Rate limiting por IP en `/api/scan` si se despliega públicamente.
- Tests de UI automatizados estables (los actuales son verificación manual con Playwright en `/tmp`).

---

## 5. Estructura de Archivos Actual

```
.
├── .env                                       # GEMINI_KEY (GITIGNORADO)
├── .gitignore                                 # node_modules, .DS_Store, .env
├── LICENSE                                    # Licencia MIT (German)
├── README.md                                  # Documentación general y demo
├── especificaciones_del_proyecto_web_to_audio.md # Spec funcional y técnico
├── ESTADO_DEL_PROYECTO.md                     # Este documento
├── index.html                                 # Playground completo
├── favicon.svg                                # Icono de la demo
├── package.json                               # Scripts (start, dev, test)
├── presets/                                   # Semillas de prueba
│   ├── cyberpunk.json
│   ├── editorial.json
│   └── indie-pastel.json
├── src/
│   ├── backend/
│   │   ├── scraper.js                         # Extracción HTML/CSS sin dependencias
│   │   ├── server.js                          # node:http + API /api/scan
│   │   ├── translator.js                      # Gemini con retries/fallback/timeout
│   │   └── url-guard.js                       # Validación anti-SSRF
│   ├── demo/
│   │   ├── analysis.js                        # Panel de progreso del análisis
│   │   ├── controls.js                        # Sliders y mapeo logarítmico
│   │   ├── demo.css                           # Estilos basados en la semilla
│   │   ├── main.js                            # Orquestación de la UI
│   │   └── visualizer.js                      # Espectro + osciloscopio
│   └── engine/
│       ├── generative.js                      # Markov, voice leading, arpegio
│       ├── reactivity.js                      # Scroll y hover
│       ├── scales.js                          # Teoría musical
│       ├── seed.js                            # Validación del contrato
│       └── soundscape.js                      # Motor Tone.js
└── test/
    ├── generative.test.js
    ├── scraper.test.js
    ├── scales.test.js
    ├── seed.test.js
    ├── server.test.js
    ├── translator.test.js
    └── url-guard.test.js
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

- Crea `.env` en la raíz con `GEMINI_KEY=...` para escanear. Está gitignorado y el servidor estático lo bloquea.
- Mantén `gemini-3.5-flash` como preferido. No uses `gemini-2.x` (retirado para esta clave) ni `gemini-3.8-flash` (latencia inaceptable).
- Respeta la regla de cero dependencias npm en backend y el lazy-loading de Tone.js.
- Si cambias el backend, reinicia `npm start` (el proceso en segundo plano no recarga solo).
- El motor no debe importar Tone.js: se inyecta desde `main.js` para conservar el lazy-loading.
- La verificación con Playwright se hizo con `playwright-core` instalado fuera del repo (`/tmp/opencode`) usando el Chromium cacheado; no añadir Playwright al `package.json` sin decisión explícita.

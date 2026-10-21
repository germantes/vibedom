# Project Spec: Generador de Atmósferas Sonoras Procedurales para Webs

## 1. Visión General del Proyecto
Una herramienta que analiza la estética, temática y estructura visual de cualquier página web (a partir de su URL) mediante IA y genera una **atmósfera sonora (soundscape) procedural, infinita y reactiva** que encaja con la identidad visual del sitio.

### Estrategia de Producto (El Combo 2 en 1)
1. **B2C / Motor de Viralidad (El Playground):** Una aplicación web donde cualquier usuario introduce una URL, visualiza el análisis estético en tiempo real y escucha cómo "suena" su página web.
2. **B2B / Conversión (El Snippet / Componente):** Justo debajo del reproductor en el Playground, el usuario puede copiar un `<script>` ultraligero (o componente para Framer/Webflow) con la configuración generada incrustada. Esto añade un micro-widget flotante a su propia web para que sus visitantes activen la atmósfera sonora.

---

## 2. Principios de Arquitectura Clave
* **Separación entre IA y Audio (Coste Cero en Reproducción):** No se utiliza IA generativa de audio (archivos MP3/WAV pesados y caros). La IA (LLM) actúa únicamente como **"Director Musical" una sola vez** durante el escaneo, traduciendo el diseño web a un objeto JSON estático ("Semilla Sonora").
* **Síntesis en el Cliente:** El motor de sonido utiliza **Tone.js (Web Audio API)** directamente en el navegador del usuario final, leyendo el JSON para generar música algorítmica e infinita que no consume ancho de banda ni recursos de servidor.
* **Enfoque en "Soundscapes", no en Canciones:** El motor genera música ambiental (*ambient, drone, lo-fi, texturas*) que acompaña la navegación sin resultar intrusiva ni repetitiva.
* **Cumplimiento de Políticas de Autoplay:** El audio jamás intenta reproducirse sin interacción previa. El widget de usuario funciona bajo demanda mediante un botón estético de activación.

---

## 3. Flujo Técnico del Sistema

### Paso 1: El Escáner (Backend / Scraper)
Recibe una URL y extrae señales estéticas y semánticas clave:
* **Semántica:** `<title>`, `meta description`, `<h1>` principales y texto visible resumido.
* **Estética (CSS Computado / DOM):** Paleta de colores dominante (fondo y acentos), familias tipográficas (`serif`, `sans-serif`, `monospace`, `display`), modo de color (claro vs. oscuro) y velocidad/presencia de transiciones o animaciones CSS.
* *(Opcional)* Captura de pantalla enviada a un modelo multimodal (Vision).

### Paso 2: El Traductor Sinestésico (LLM)
Un LLM rápido recibe los datos extraídos y devuelve **estrictamente un JSON** que sigue el contrato del motor de audio.

### Paso 3: El Motor Procedural (Frontend - Tone.js)
Un motor de síntesis modular construido con Tone.js que interpreta el JSON recibido. Consta de tres capas principales y un bus de efectos:
1. **Capa 1 - Pad / Drone:** Acordes largos y envolventes (ataque y relajación lentos) que definen la armonía.
2. **Capa 2 - Arpegio / Melodía Generativa:** Notas sueltas disparadas algorítmicamente (usando probabilidades o cadenas de Markov simples) dentro de la escala musical definida.
3. **Capa 3 - Textura / Efectos:** Filtros paso-bajo (*Lowpass Filter*), *Reverb* espacial, *Delay* y *Chorus*.
4. **Reactividad al DOM:** Eventos de navegador (`scroll`, `mousemove`) que modulan parámetros del sintetizador en tiempo real (ej. abrir la frecuencia del filtro al hacer *scroll* rápido).

---

## 4. Contrato de Datos: El JSON ("Semilla Sonora")

Este es el esquema que el LLM debe generar y que el motor de Tone.js debe consumir:

```json
{
  "metadata": {
    "url": "https://ejemplo.com",
    "detectedVibe": "Minimalista, técnico y oscuro",
    "explanation": "Tipografía monospace y fondo negro puro traducidos a una escala Frigia a bajo tempo con texturas analógicas cálidas."
  },
  "uiTheme": {
    "backgroundColor": "#0A0A0A",
    "accentColor": "#00FF66",
    "textColor": "#FFFFFF",
    "fontFamily": "monospace"
  },
  "musicalParams": {
    "bpm": 75,
    "rootNote": "D",
    "scale": "phrygian",
    "octave": 3
  },
  "synthConfig": {
    "pad": {
      "waveform": "sawtooth",
      "attack": 2.5,
      "release": 4.0,
      "filterFreq": 600
    },
    "arp": {
      "enabled": true,
      "waveform": "triangle",
      "density": 0.4,
      "delayWet": 0.6
    },
    "effects": {
      "reverbDecay": 6.0,
      "reverbWet": 0.7,
      "chorusDepth": 0.3
    },
    "interactivity": {
      "scrollTarget": "filterFreq",
      "scrollMultiplier": 2.5,
      "hoverNoteTrigger": true
    }
  }
}
```

---

## 5. Requisitos del Snippet Embebible (El Widget)
Para garantizar que diseñadores (Framer, Webflow) y desarrolladores instalen el código en sus webs:
* **Lazy Loading Estricto:** El script inicial debe pesar `< 5 KB` y limitarse a renderizar el botón flotante en el DOM (usando los colores de `uiTheme`). La librería **Tone.js solo se descarga desde el CDN cuando el visitante hace clic en el botón por primera vez**.
* **Cero Dependencias Externas en Carga Inicial:** Vanilla JS puro encapsulado (Shadow DOM o estilos con prefijo único) para no contaminar el CSS de la web huésped.
* **Micro-interacción:** Un botón flotante minimalista con un indicador visual animado (ondas o barras de audio en CSS/SVG) que indique si la atmósfera está activa o en pausa.

---

## 6. Plan de Implementación (Roadmap para el Desarrollo)

### Fase 1: Prototipo del Motor de Audio (Core en Tone.js)
* Crear un módulo en JavaScript/TypeScript aislado que inicialice Tone.js a partir del JSON de contrato.
* Implementar un generador de escalas musicales (Mayor, Menor, Dórica, Frigia, Pentatónica, Lidia) a partir de una nota raíz (`rootNote`).
* Configurar los sintetizadores (`PolySynth` para el Pad, `Synth` o `FMSynth` para el arpegio) y la cadena de efectos (`Filter` -> `Chorus` -> `FeedbackDelay` -> `Reverb` -> `Destination`).
* Implementar la lógica de *loop* infinito (`Tone.Loop` o `Tone.Sequence`) con generación probabilística para que nunca suene exactamente repetitivo.
* Añadir el listener de `scroll` para modular el filtro en tiempo real.
* **Entregable Fase 1:** Una página HTML/JS simple con 3 botones de prueba (ej. *"Preset Cyberpunk"*, *"Preset Editorial Elegante"*, *"Preset Indie Pastel"*) para validar y afinar la calidad del sonido.

### Fase 2: El Escáner + Integración con LLM
* Crear el endpoint de backend que reciba una URL, extraiga el DOM/CSS relevante y llame a la API del LLM con *Structured Outputs* (JSON Schema estricto).

### Fase 3: Interfaz del Playground
* Construir la landing page interactiva donde el usuario pega la URL, ve la animación de análisis estético, escucha su web y puede ajustar un par de sliders manuales si quiere personalizar el resultado.

### Fase 4: Generador de Snippet / Componente Framer
* Crear el empaquetador que inyecta el JSON generado dentro de la plantilla del widget ligero y ofrece el código listo para copiar y pegar.

---

## 7. Prompt Inicial para el Asistente de Código (Claude Opus)
> *"Actúa como un Senior Creative Technologist experto en Web Audio API, Tone.js y desarrollo Full-Stack. Lee detenidamente esta especificación de proyecto. Vamos a empezar exclusivamente por la **Fase 1 (El Motor de Audio en Tone.js)** para asegurarnos de que la síntesis procedural suena verdaderamente bien, orgánica y musical antes de construir el resto de la aplicación. Propón la arquitectura del motor de audio y genera un prototipo funcional con 3 presets JSON muy distintos entre sí para probarlo en el navegador."*
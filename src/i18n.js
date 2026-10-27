// Diccionarios ES/EN y utilidades de traducción para las páginas estáticas.
// El idioma se deduce del atributo <html lang>, así que cada ruta (/ y /en/)
// mantiene su propio HTML y no necesita JavaScript para elegir el idioma.

const DICTS = {
  es: {
    "common.skip": "Saltar al contenido",

    "nav.how": "Cómo funciona",
    "nav.privacy": "Privacidad",
    "nav.faq": "Preguntas",
    "nav.playground": "Abrir playground",
    "nav.langSwitch": "EN",
    "nav.langSwitchAria": "Ver esta página en inglés",

    "landing.title": "vibedom · ¿A qué suena tu web?",
    "landing.description":
      "¿A qué suena tu web? Pega una URL y escucha su atmósfera sonora: vibedom lee su paleta, tipografía y movimiento y los convierte en música generativa en tu navegador.",
    "landing.eyebrow": "Web → música · en tu navegador",
    "landing.h1": "¿A qué suena tu web?",
    "landing.lead":
      "Toda web ya tiene una banda sonora: está en su paleta, su tipografía y su movimiento. Pega una URL y vibedom la convierte en música generativa. Sin samples, sin registro, sin subir nada.",
    "landing.form.label": "URL de tu web",
    "landing.form.placeholder": "https://tuweb.com",
    "landing.form.button": "Escuchar mi web",
    "landing.form.hint":
      "Tarda unos segundos. La música se sintetiza en tu navegador; no hay audio pregrabado.",
    "landing.trust.samples": "samples",
    "landing.trust.synthesized": "sintetizado",
    "landing.trust.account": "Sin registro",

    "landing.demo.eyebrow": "Demo en vivo",
    "landing.demo.presetsAria": "Elige una demo",
    "landing.demo.paletteAria": "Paleta de la demo",
    "landing.demo.play": "Reproducir",
    "landing.demo.pause": "Pausar",
    "landing.demo.ready": "Demo lista. Pulsa play para escuchar.",
    "landing.demo.loading": "Cargando demos…",
    "landing.demo.source": "Escuchando",

    "landing.how.eyebrow": "Cómo funciona",
    "landing.how.title": "De la estética al sonido en tres pasos.",
    "landing.how.lead":
      "Nada de samples ni playlists. Una semilla sonora se genera una vez y tu navegador la interpreta para siempre.",
    "landing.how.step1.title": "Pega la URL",
    "landing.how.step1.body":
      "Leemos el HTML y las hojas de estilo públicas de la web. Solo lo que cualquiera puede ver.",
    "landing.how.step2.title": "Leemos la estética",
    "landing.how.step2.body":
      "Paleta, contraste, tipografía, jerarquía y movimiento se traducen a una semilla sonora: tonalidad, tempo, timbres y efectos.",
    "landing.how.step3.title": "Suena",
    "landing.how.step3.body":
      "Tone.js sintetiza pad, drone y arpegio en tu navegador. La misma web suena distinta a la siguiente: es generativa.",

    "landing.why.eyebrow": "Lo que no es",
    "landing.why.title": "No es un jingle. Es una identidad sonora.",
    "landing.why.lead":
      "vibedom no adivina tu género favorito. Traduce decisiones de diseño —color, ritmo visual, tipografía— a decisiones musicales.",
    "landing.why.card1.title": "Generativa de verdad",
    "landing.why.card1.body":
      "El motor recorre escalas, acordes y arpegios con reglas armónicas. No hay un archivo de audio dando vueltas.",
    "landing.why.card2.title": "Hecha a medida",
    "landing.why.card2.body":
      "Cada web produce una semilla distinta. Dos webs con la misma paleta pueden sonar completamente diferentes.",
    "landing.why.card3.title": "Reactiva",
    "landing.why.card3.body":
      "El scroll modula el brillo, la reverb o la densidad del arpegio. La página se mueve y la música responde.",

    "landing.privacy.eyebrow": "Privacidad",
    "landing.privacy.title": "Tu web no se queda con nosotros.",
    "landing.privacy.lead":
      "No guardamos capturas, HTML ni contenido. Solo leemos lo público, generamos una semilla y la música ocurre en tu navegador.",
    "landing.privacy.item1": "Sin cuentas ni registro.",
    "landing.privacy.item2": "Sin cookies de seguimiento ni analytics de terceros.",
    "landing.privacy.item3": "Sin audio pregrabado ni streaming: cero samples.",
    "landing.privacy.item4":
      "La semilla se cachea en memoria una hora; ni tu URL ni el HTML tocan el disco.",

    "landing.cta.eyebrow": "Modo laboratorio",
    "landing.cta.title": "¿Quieres abrir la cabina?",
    "landing.cta.lead":
      "En el playground puedes ver la semilla, mover tempo, brillo, espacialidad y densidad, y mirar el espectro mientras suena.",
    "landing.cta.button": "Abrir el playground",

    "landing.faq.title": "Preguntas frecuentes",
    "landing.faq.q1": "¿Qué analiza exactamente?",
    "landing.faq.a1":
      "La paleta y el color de fondo dominante, el contraste, las familias tipográficas, la jerarquía de encabezados y las señales de movimiento (animaciones, transiciones). Todo desde HTML y CSS públicos.",
    "landing.faq.q2": "¿De dónde sale el audio?",
    "landing.faq.a2":
      "No hay audio pregrabado. Tone.js construye un grafo de sintetizadores en tu navegador y lo alimenta con una semilla sonora. Cada reproducción sigue siendo generativa.",
    "landing.faq.q3": "¿Funciona con cualquier web?",
    "landing.faq.a3":
      "Con cualquier URL http(s) pública. Algunas webs bloquean a los bots o dependen de JavaScript para pintar su estilo; en esos casos el análisis puede quedarse corto.",
    "landing.faq.q4": "¿Guardáis mi URL?",
    "landing.faq.a4":
      "No la guardamos en ninguna base de datos. El resultado del análisis queda en memoria hasta una hora para no repetir la consulta, y después desaparece.",
    "landing.faq.q5": "¿Necesito registrarme o pagar?",
    "landing.faq.a5":
      "No. La demo es abierta. El único requisito es que el backend esté disponible para escanear URLs nuevas; los presets funcionan sin él.",
    "landing.faq.q6": "¿A qué suena mi web?",
    "landing.faq.a6":
      "A una pieza generativa construida con sus propios rasgos: los colores y el contraste fijan el modo y la energía, la tipografía sugiere los timbres y el movimiento marca el tempo. No suena igual dos veces, pero siempre suena a ella.",
    "landing.footer.tagline": "Atmósferas sonoras procedurales para la web.",

    "status.loadingTone": "Descargando el sintetizador…",
    "status.loadingPresets": "Cargando demos…",
    "status.ready": "Demo lista. Pulsa play para escuchar.",
    "status.playing": "Sonando: {vibe}",
    "status.paused": "En pausa.",
    "status.invalidUrl": "Escribe una URL válida, por ejemplo https://stripe.com",
    "status.audioBlocked": "El navegador ha bloqueado el audio. Pulsa play para activarlo.",
    "status.analysisReady": "Análisis listo. Pulsa play para escuchar tu web.",
    "status.backendMissing":
      "El analizador no está disponible ahora mismo. Prueba un preset o inténtalo de nuevo en unos segundos.",
    "status.backendMissingStatic":
      "Esta demo está alojada en GitHub Pages, que solo sirve archivos estáticos. Para escanear URLs, arranca el backend en local con `npm start` y abre http://localhost:3000. Mientras tanto, prueba un preset.",
    "status.staticHint":
      "Estás en la demo estática: los presets suenan aquí. Para escanear tu web, arranca el backend con `npm start` y abre http://localhost:3000.",
    "status.remoteHint":
      "El análisis tarda unos segundos. Si es el primero del día, puede tardar un poco más mientras arranca el servicio.",
    "status.backendUnreachable":
      "No se pudo conectar con el analizador. Puede estar arrancando: espera unos segundos e inténtalo de nuevo.",
    "status.scanError": "No se pudo analizar: {message}",
    "status.rateLimited":
      "El analizador está saturado ahora mismo. Espera {seconds} s y vuelve a intentarlo.",
    "status.rateLimitedMinutes":
      "El analizador está saturado. Espera {minutes} min y vuelve a intentarlo.",
    "status.rateLimitedLong":
      "El analizador ha alcanzado su límite de uso. Se renueva en unas {hours} h; mientras tanto, prueba un preset.",
    "status.cancelled": "Análisis cancelado.",
    "status.presetsError": "No se pudieron cargar las demos. Recarga la página.",
    "status.audioError": "Semilla lista, pero no se pudo iniciar el audio: {message}",

    "analysis.step.0": "Extrayendo paleta y tipografía",
    "analysis.step.1": "Leyendo la estructura y el tono",
    "analysis.step.2": "Traduciendo la estética a armonía",
    "analysis.step.3": "Sintetizando la atmósfera",
    "analysis.step.4": "Afinando el soundscape",
    "analysis.sub.download": "Descargando y analizando el HTML y las hojas de estilo.",
    "analysis.sub.translate": "Gemini está convirtiendo la estética en una semilla sonora.",
    "analysis.sub.wait": "Seguimos esperando al modelo · {seconds} s",
    "analysis.done.title": "Atmósfera lista",
    "analysis.done.sub": "La semilla sonora ya está generada.",
    "analysis.fail.title": "No se pudo completar el análisis",
    "analysis.cancel.title": "Análisis cancelado",
    "analysis.cancel.sub": "Puedes probar con otra URL o reintentarlo.",
    "analysis.cancel": "Cancelar",
    "analysis.retry": "Reintentar",

    "playground.title": "vibedom · Playground",
    "playground.description":
      "Laboratorio técnico de vibedom: escanea una web, ajusta la semilla sonora, mira el espectro y regenera variaciones.",
    "playground.docTitle": "vibedom · Playground",
    "playground.back": "← Volver a la landing",
    "playground.langSwitch": "EN",
    "playground.langSwitchAria": "Ver esta página en inglés",
    "playground.eyebrow": "Modo laboratorio",
    "playground.h1": "Escucha, ajusta, rompe.",
    "playground.lead":
      "Escanea una URL o elige un preset. Aquí sí ves la semilla, los sliders y el espectro.",
    "playground.form.label": "URL de la web",
    "playground.form.placeholder": "https://ejemplo.com",
    "playground.form.button": "Escanear",
    "playground.form.hint":
      "Analizamos la paleta, la tipografía y el movimiento de la web. Suele tardar unos segundos.",
    "playground.presets.label": "Presets",
    "playground.preset.cyberpunk": "Preset Cyberpunk",
    "playground.preset.editorial": "Preset Editorial Elegante",
    "playground.preset.indie": "Preset Indie Pastel",

    "preset.cyberpunk.vibe": "Cyberpunk: técnico, nocturno y neón",
    "preset.cyberpunk.explanation":
      "Fondo negro puro, acentos verde neón y tipografía monospace traducidos a Re frigio grave, sierras desafinadas tras un filtro cerrado y un arpegio de eco que recuerda a datos fluyendo.",
    "preset.editorial.vibe": "Editorial elegante: sereno, luminoso y espacioso",
    "preset.editorial.explanation":
      "Mucho espacio en blanco, serif clásica y tonos marfil traducidos a Fa lidio lento con pads de seno muy suaves, reverb de catedral y notas aisladas como pinceladas.",
    "preset.indie-pastel.vibe": "Indie pastel: cálido, juguetón y lo-fi",
    "preset.indie-pastel.explanation":
      "Colores pastel, esquinas redondeadas y una display amable traducidos a Sol pentatónico con triángulos cálidos, chorus marcado tipo cinta y un arpegio inquieto que crece al hacer scroll.",
    "playground.play": "Reproducir",
    "playground.pause": "Pausar",
    "playground.status.loadingPresets": "Cargando presets…",
    "playground.vibe.eyebrow": "Identidad detectada",
    "playground.vibe.palette": "Paleta detectada",
    "playground.palette.background": "Fondo",
    "playground.palette.accent": "Acento",
    "playground.palette.text": "Texto",
    "playground.source": "Origen",
    "playground.controls.title": "Ajuste fino",
    "playground.controls.sub":
      "Sin volver a llamar a la IA. Se aplica en caliente si está sonando.",
    "playground.controls.regenerate": "Regenerar variación",
    "playground.control.tempo": "Tempo",
    "playground.control.brightness": "Brillo",
    "playground.control.spatiality": "Espacialidad",
    "playground.control.density": "Densidad melódica",
    "playground.control.hint":
      "El brillo abre el filtro del pad; la espacialidad moja la reverb; la densidad decide cuántas notas del arpegio suenan.",
    "playground.reactivity.title": "Prueba la reactividad",
    "playground.reactivity.bodyHtml":
      "Haz scroll rápido por esta página: la semilla elige un parámetro y lo modula. Pasa el ratón por estos enlaces para disparar notas de la escala: <a href=\"#a\">uno</a> · <a href=\"#b\">dos</a> · <a href=\"#c\">tres</a> · <a href=\"#d\">cuatro</a> · <a href=\"#e\">cinco</a>",
    "playground.json.title": "Semilla Sonora (JSON)",
    "playground.json.sub":
      "Esto es lo único que se genera con IA. La música se sintetiza entera en tu navegador.",
    "playground.footer.samples": "Sin audio pregrabado · Tone.js bajo demanda",
    "playground.footer.github": "GitHub",
    "playground.arpOff": "Arpegio off",
    "playground.arpOffAria": "Arpegio desactivado en esta semilla",
    "playground.status.ready": "Listo. Pulsa Reproducir.",
    "playground.status.analysisReady": "Análisis listo. Pulsa Reproducir para escuchar tu web.",
    "playground.status.playing": "Sonando: {vibe}",
    "playground.status.paused": "En pausa.",
    "playground.status.loadingTone": "Descargando Tone.js…",
    "playground.status.invalidUrl": "Escribe una URL válida, por ejemplo https://stripe.com",
    "playground.status.audioBlocked":
      "El navegador ha bloqueado el audio. Pulsa Reproducir para activarlo.",
    "playground.status.scanError": "No se pudo analizar: {message}",
    "playground.status.rateLimited":
      "El analizador está saturado ahora mismo. Espera {seconds} s y vuelve a intentarlo.",
    "playground.status.rateLimitedMinutes":
      "El analizador está saturado. Espera {minutes} min y vuelve a intentarlo.",
    "playground.status.rateLimitedLong":
      "El analizador ha alcanzado su límite de uso. Se renueva en unas {hours} h; mientras tanto, prueba un preset.",
    "playground.status.cancelled": "Análisis cancelado.",
    "playground.status.presetsError": "No se pudieron cargar los presets. Recarga la página.",
    "playground.status.audioError": "Semilla lista, pero no se pudo iniciar el audio: {message}",
    "playground.status.regenerate": "Pulsa Reproducir para escuchar la variación.",
    "playground.status.variation": "Nueva variación · grado {degree} de la escala.",

    "param.mode": "Modo",
    "param.key": "Tonalidad",
    "param.tempo": "Tempo",
    "param.type": "Tipografía",
    "param.padWave": "Onda pad",
    "param.brightness": "Brillo",
    "param.arp": "Arpegio",
    "param.reverb": "Reverb",
    "param.scroll": "Scroll",
    "param.mode.dark": "oscuro",
    "param.mode.light": "claro",
    "value.off": "off",
    "wave.sine": "seno",
    "wave.triangle": "triángulo",
    "wave.sawtooth": "sierra",
    "wave.square": "cuadrada",
    "scale.major": "mayor",
    "scale.minor": "menor",
    "scale.dorian": "dórico",
    "scale.phrygian": "frigio",
    "scale.lydian": "lidio",
    "scale.pentatonic": "pentatónica",
    "scroll.filterFreq": "brillo",
    "scroll.reverbWet": "espacialidad",
    "scroll.delayWet": "eco",
    "scroll.arpDensity": "densidad",
  },

  en: {
    "common.skip": "Skip to content",

    "nav.how": "How it works",
    "nav.privacy": "Privacy",
    "nav.faq": "FAQ",
    "nav.playground": "Open playground",
    "nav.langSwitch": "ES",
    "nav.langSwitchAria": "View this page in Spanish",

    "landing.title": "vibedom · What does your website sound like?",
    "landing.description":
      "What does your website sound like? Paste a URL and hear its soundscape: vibedom reads its palette, typography and motion, then turns them into generative music in your browser.",
    "landing.eyebrow": "Web → music · in your browser",
    "landing.h1": "What does your website sound like?",
    "landing.lead":
      "Every site already has a soundtrack: it's in its palette, its typography and its motion. Paste a URL and vibedom turns it into generative music. No samples, no sign-up, no uploads.",
    "landing.form.label": "Your website URL",
    "landing.form.placeholder": "https://yoursite.com",
    "landing.form.button": "Hear my site",
    "landing.form.hint":
      "It takes a few seconds. The music is synthesised in your browser; there is no pre-recorded audio.",
    "landing.trust.samples": "samples",
    "landing.trust.synthesized": "synthesised",
    "landing.trust.account": "No sign-up",

    "landing.demo.eyebrow": "Live demo",
    "landing.demo.presetsAria": "Choose a demo",
    "landing.demo.paletteAria": "Demo palette",
    "landing.demo.play": "Play",
    "landing.demo.pause": "Pause",
    "landing.demo.ready": "Demo ready. Hit play to listen.",
    "landing.demo.loading": "Loading demos…",
    "landing.demo.source": "Listening to",

    "landing.how.eyebrow": "How it works",
    "landing.how.title": "From aesthetics to sound in three steps.",
    "landing.how.lead":
      "No samples, no playlists. A sound seed is generated once and your browser performs it forever.",
    "landing.how.step1.title": "Paste the URL",
    "landing.how.step1.body":
      "We read the public HTML and stylesheets. Only what anyone can see.",
    "landing.how.step2.title": "Read the aesthetics",
    "landing.how.step2.body":
      "Palette, contrast, typography, hierarchy and motion become a sound seed: key, tempo, timbres and effects.",
    "landing.how.step3.title": "Press play",
    "landing.how.step3.body":
      "Tone.js synthesises pad, drone and arpeggio in your browser. The same site sounds different next time: it's generative.",

    "landing.why.eyebrow": "What it isn't",
    "landing.why.title": "Not a jingle. A sonic identity.",
    "landing.why.lead":
      "vibedom doesn't guess your favourite genre. It translates design decisions — colour, visual rhythm, type — into musical ones.",
    "landing.why.card1.title": "Genuinely generative",
    "landing.why.card1.body":
      "The engine walks scales, chords and arpeggios with harmonic rules. There is no audio file looping in the background.",
    "landing.why.card2.title": "Made to measure",
    "landing.why.card2.body":
      "Every site produces a different seed. Two sites with the same palette can sound completely different.",
    "landing.why.card3.title": "Reactive",
    "landing.why.card3.body":
      "Scrolling modulates brightness, reverb or arpeggio density. The page moves and the music answers.",

    "landing.privacy.eyebrow": "Privacy",
    "landing.privacy.title": "Your site doesn't stay with us.",
    "landing.privacy.lead":
      "We don't store screenshots, HTML or content. We only read what's public, generate a seed, and the music happens in your browser.",
    "landing.privacy.item1": "No accounts or sign-up.",
    "landing.privacy.item2": "No tracking cookies or third-party analytics.",
    "landing.privacy.item3": "No pre-recorded audio or streaming: zero samples.",
    "landing.privacy.item4":
      "The seed is cached in memory for an hour; neither your URL nor the HTML touches disk.",

    "landing.cta.eyebrow": "Lab mode",
    "landing.cta.title": "Want to open the console?",
    "landing.cta.lead":
      "In the playground you can inspect the seed, move tempo, brightness, spaciousness and density, and watch the spectrum while it plays.",
    "landing.cta.button": "Open the playground",

    "landing.faq.title": "Frequently asked questions",
    "landing.faq.q1": "What exactly does it analyse?",
    "landing.faq.a1":
      "Dominant palette and background colour, contrast, type families, heading hierarchy and motion signals (animations, transitions) — all from public HTML and CSS.",
    "landing.faq.q2": "Where does the audio come from?",
    "landing.faq.a2":
      "There is no pre-recorded audio. Tone.js builds a synth graph in your browser and feeds it a sound seed. Every playback is still generative.",
    "landing.faq.q3": "Does it work with any site?",
    "landing.faq.a3":
      "With any public http(s) URL. Some sites block bots or rely on JavaScript to paint their style; in those cases the analysis may fall short.",
    "landing.faq.q4": "Do you store my URL?",
    "landing.faq.a4":
      "We don't store it in any database. The analysis stays in memory for up to an hour so we don't repeat the request, then it's gone.",
    "landing.faq.q5": "Do I need an account or payment?",
    "landing.faq.a5":
      "No. The demo is open. The only requirement for scanning new URLs is a running backend; presets work without it.",
    "landing.faq.q6": "What does my website sound like?",
    "landing.faq.a6":
      "Like a generative piece built from its own traits: colours and contrast set the mode and energy, typography suggests the timbres, and motion sets the tempo. It never plays the same way twice, but it always sounds like itself.",
    "landing.footer.tagline": "Procedural soundscapes for the web.",

    "status.loadingTone": "Downloading the synth…",
    "status.loadingPresets": "Loading demos…",
    "status.ready": "Demo ready. Hit play to listen.",
    "status.playing": "Now playing: {vibe}",
    "status.paused": "Paused.",
    "status.invalidUrl": "Enter a valid URL, for example https://stripe.com",
    "status.audioBlocked": "The browser blocked audio. Press play to enable it.",
    "status.analysisReady": "Analysis ready. Press play to hear your site.",
    "status.backendMissing":
      "The analyser isn't available right now. Try a preset or try again in a few seconds.",
    "status.backendMissingStatic":
      "This demo is hosted on GitHub Pages, which only serves static files. To scan URLs, start the backend locally with `npm start` and open http://localhost:3000. In the meantime, try a preset.",
    "status.staticHint":
      "You're on the static demo: presets play here. To scan your site, start the backend with `npm start` and open http://localhost:3000.",
    "status.remoteHint":
      "Analysis takes a few seconds. If it's the first of the day, it may take a little longer while the service wakes up.",
    "status.backendUnreachable":
      "Couldn't reach the analyser. It may be waking up: wait a few seconds and try again.",
    "status.scanError": "Couldn't analyse: {message}",
    "status.rateLimited": "The analyser is busy right now. Wait {seconds}s and try again.",
    "status.rateLimitedMinutes": "The analyser is busy. Wait {minutes} min and try again.",
    "status.rateLimitedLong":
      "The analyser has reached its usage limit. It renews in about {hours}h; try a preset in the meantime.",
    "status.cancelled": "Analysis cancelled.",
    "status.presetsError": "Couldn't load the demos. Reload the page.",
    "status.audioError": "Seed ready, but audio couldn't start: {message}",

    "analysis.step.0": "Extracting palette and typography",
    "analysis.step.1": "Reading structure and tone",
    "analysis.step.2": "Translating aesthetics into harmony",
    "analysis.step.3": "Synthesising the atmosphere",
    "analysis.step.4": "Tuning the soundscape",
    "analysis.sub.download": "Downloading and analysing the HTML and stylesheets.",
    "analysis.sub.translate": "Gemini is turning the aesthetics into a sound seed.",
    "analysis.sub.wait": "Still waiting for the model · {seconds}s",
    "analysis.done.title": "Atmosphere ready",
    "analysis.done.sub": "The sound seed is generated.",
    "analysis.fail.title": "Analysis couldn't complete",
    "analysis.cancel.title": "Analysis cancelled",
    "analysis.cancel.sub": "Try another URL or retry.",
    "analysis.cancel": "Cancel",
    "analysis.retry": "Retry",

    "playground.title": "vibedom · Playground",
    "playground.description":
      "vibedom's technical lab: scan a site, tweak the sound seed, watch the spectrum and regenerate variations.",
    "playground.docTitle": "vibedom · Playground",
    "playground.back": "← Back to landing",
    "playground.langSwitch": "ES",
    "playground.langSwitchAria": "Ver esta página en español",
    "playground.eyebrow": "Lab mode",
    "playground.h1": "Listen, tweak, break things.",
    "playground.lead":
      "Scan a URL or pick a preset. Here you can see the seed, the sliders and the spectrum.",
    "playground.form.label": "Website URL",
    "playground.form.placeholder": "https://example.com",
    "playground.form.button": "Scan",
    "playground.form.hint":
      "We analyse the site's palette, typography and motion. It usually takes a few seconds.",
    "playground.presets.label": "Presets",
    "playground.preset.cyberpunk": "Cyberpunk preset",
    "playground.preset.editorial": "Elegant Editorial preset",
    "playground.preset.indie": "Indie Pastel preset",

    "preset.cyberpunk.vibe": "Cyberpunk: technical, nocturnal and neon",
    "preset.cyberpunk.explanation":
      "A pure black background, neon green accents and monospace type translated into a low D phrygian, detuned saws behind a closed filter and an echo arpeggio that recalls flowing data.",
    "preset.editorial.vibe": "Elegant editorial: serene, luminous and spacious",
    "preset.editorial.explanation":
      "Lots of white space, classic serif and ivory tones translated into a slow F lydian with very soft sine pads, cathedral reverb and isolated notes like brushstrokes.",
    "preset.indie-pastel.vibe": "Indie pastel: warm, playful and lo-fi",
    "preset.indie-pastel.explanation":
      "Pastel colours, rounded corners and a friendly display face translated into G pentatonic with warm triangles, tape-like chorus and a restless arpeggio that grows as you scroll.",
    "playground.play": "Play",
    "playground.pause": "Pause",
    "playground.status.loadingPresets": "Loading presets…",
    "playground.vibe.eyebrow": "Detected identity",
    "playground.vibe.palette": "Detected palette",
    "playground.palette.background": "Background",
    "playground.palette.accent": "Accent",
    "playground.palette.text": "Text",
    "playground.source": "Source",
    "playground.controls.title": "Fine-tuning",
    "playground.controls.sub":
      "No second AI call. Changes apply live while it's playing.",
    "playground.controls.regenerate": "Regenerate variation",
    "playground.control.tempo": "Tempo",
    "playground.control.brightness": "Brightness",
    "playground.control.spatiality": "Spaciousness",
    "playground.control.density": "Melodic density",
    "playground.control.hint":
      "Brightness opens the pad filter; spaciousness soaks the reverb; density decides how many arpeggio notes play.",
    "playground.reactivity.title": "Try the reactivity",
    "playground.reactivity.bodyHtml":
      "Scroll fast through this page: the seed picks a parameter and modulates it. Hover these links to trigger notes from the scale: <a href=\"#a\">one</a> · <a href=\"#b\">two</a> · <a href=\"#c\">three</a> · <a href=\"#d\">four</a> · <a href=\"#e\">five</a>",
    "playground.json.title": "Sound Seed (JSON)",
    "playground.json.sub":
      "This is the only thing AI generates. The music is synthesised entirely in your browser.",
    "playground.footer.samples": "No pre-recorded audio · Tone.js on demand",
    "playground.footer.github": "GitHub",
    "playground.arpOff": "Arpeggio off",
    "playground.arpOffAria": "Arpeggio disabled in this seed",
    "playground.status.ready": "Ready. Press Play.",
    "playground.status.analysisReady": "Analysis ready. Press Play to hear your site.",
    "playground.status.playing": "Now playing: {vibe}",
    "playground.status.paused": "Paused.",
    "playground.status.loadingTone": "Downloading Tone.js…",
    "playground.status.invalidUrl": "Enter a valid URL, for example https://stripe.com",
    "playground.status.audioBlocked": "The browser blocked audio. Press Play to enable it.",
    "playground.status.scanError": "Couldn't analyse: {message}",
    "playground.status.rateLimited": "The analyser is busy right now. Wait {seconds}s and try again.",
    "playground.status.rateLimitedMinutes": "The analyser is busy. Wait {minutes} min and try again.",
    "playground.status.rateLimitedLong":
      "The analyser has reached its usage limit. It renews in about {hours}h; try a preset in the meantime.",
    "playground.status.cancelled": "Analysis cancelled.",
    "playground.status.presetsError": "Couldn't load the presets. Reload the page.",
    "playground.status.audioError": "Seed ready, but audio couldn't start: {message}",
    "playground.status.regenerate": "Press Play to hear the variation.",
    "playground.status.variation": "New variation · degree {degree} of the scale.",

    "param.mode": "Mode",
    "param.key": "Key",
    "param.tempo": "Tempo",
    "param.type": "Typography",
    "param.padWave": "Pad wave",
    "param.brightness": "Brightness",
    "param.arp": "Arpeggio",
    "param.reverb": "Reverb",
    "param.scroll": "Scroll",
    "param.mode.dark": "dark",
    "param.mode.light": "light",
    "value.off": "off",
    "wave.sine": "sine",
    "wave.triangle": "triangle",
    "wave.sawtooth": "saw",
    "wave.square": "square",
    "scale.major": "major",
    "scale.minor": "minor",
    "scale.dorian": "dorian",
    "scale.phrygian": "phrygian",
    "scale.lydian": "lydian",
    "scale.pentatonic": "pentatonic",
    "scroll.filterFreq": "brightness",
    "scroll.reverbWet": "spaciousness",
    "scroll.delayWet": "echo",
    "scroll.arpDensity": "density",
  },
};

const lang = (document.documentElement.lang || "es").toLowerCase().startsWith("en") ? "en" : "es";

/** Idioma activo de la página, deducido de <html lang>. */
export function getLang() {
  return lang;
}

const PRESET_COPY_IDS = ["cyberpunk", "editorial", "indie-pastel"];

/**
 * Copia localizada de un preset. Los presets son estáticos y sus JSON guardan
 * la versión en español; aquí se traduce solo lo que se muestra al usuario.
 */
export function presetCopy(id) {
  if (!PRESET_COPY_IDS.includes(id)) return null;
  return {
    detectedVibe: t(`preset.${id}.vibe`),
    explanation: t(`preset.${id}.explanation`),
  };
}

/** Traduce una clave y sustituye marcadores `{nombre}`. */
export function t(key, vars = {}) {
  const template = DICTS[lang]?.[key] ?? DICTS.es[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (match, name) =>
    Object.hasOwn(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Mensaje de cuota adaptado a la espera real. Google puede pedir 52 000 s
 * cuando se agota el cupo diario: decir "espera 52 000 s" no ayuda a nadie.
 * A partir de 10 minutos lo tratamos como límite de uso y damos horas.
 */
export function rateLimitCopy(retryAfter, prefix = "status") {
  const seconds = Math.max(1, Math.ceil(Number(retryAfter) || 30));
  if (seconds >= 600) {
    return t(`${prefix}.rateLimitedLong`, { hours: Math.max(1, Math.ceil(seconds / 3600)) });
  }
  if (seconds >= 90) {
    return t(`${prefix}.rateLimitedMinutes`, { minutes: Math.ceil(seconds / 60) });
  }
  return t(`${prefix}.rateLimited`, { seconds });
}

/**
 * Aplica las traducciones declarativas del HTML:
 * - data-i18n         → textContent
 * - data-i18n-html    → innerHTML (solo para copia estática de confianza)
 * - data-i18n-<attr>  → atributo (placeholder, aria-label, title, content…)
 */
export function applyI18n(root = document) {
  root.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });

  root.querySelectorAll("[data-i18n-html]").forEach((el) => {
    el.innerHTML = t(el.dataset.i18nHtml);
  });

  for (const attr of ["placeholder", "aria-label", "title", "content"]) {
    root.querySelectorAll(`[data-i18n-${attr}]`).forEach((el) => {
      el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
    });
  }
}

/** Copia del panel de análisis para createAnalysis(). */
export function analysisCopy() {
  return {
    steps: [0, 1, 2, 3, 4].map((index) => t(`analysis.step.${index}`)),
    download: t("analysis.sub.download"),
    translate: t("analysis.sub.translate"),
    waiting: (seconds) => t("analysis.sub.wait", { seconds }),
    doneTitle: t("analysis.done.title"),
    doneSub: t("analysis.done.sub"),
    failTitle: t("analysis.fail.title"),
    cancelTitle: t("analysis.cancel.title"),
    cancelSub: t("analysis.cancel.sub"),
  };
}

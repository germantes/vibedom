# Guía de marketing de vibedom

Plan práctico, sin presupuesto, para llevar vibedom de "producto terminado" a "producto descubierto".
Estado el 2026-11-24: el backend responde, el ranking guarda datos, pero en 30 días solo se
escanearon 5 dominios. El problema no es el producto: es que nadie lo conoce todavía.

---

## 1. Diagnóstico: qué tienes ya y qué falta

**Ventajas que casi ningún side project tiene:**

- Producto funcionando en dominio propio con HTTPS (`vibedom.dev`), ES/EN, sitemap, hreflang y JSON-LD.
- Un "momento compartible" innato: escaneas una web y sale un sonido. Es demo-able en 10 segundos.
- Historia técnica atractiva: audio 100 % sintetizado en el navegador, cero samples, cero backend de audio, widget < 5 KB en Shadow DOM.
- Widget embebible (crecimiento propio: cada web que lo incrusta es un cartel gratuito).
- Ranking público Hoy / 7 días / 30 días (razón para volver).
- Historial local de escaneos y exportar/importar la semilla (retención y portabilidad desde 2026-11-24).
- Privacidad real (sin cuentas, sin cookies, sin analytics de terceros): un mensaje diferenciador, no un parche.

**Frenos reales a la difusión:**

- Un concepto que hay que oír para entender ("¿a qué suena tu web?" suena raro hasta que suena).
- Render free duerme: el primer visitante tras un rato espera ~25 s (grava cada demo compartida).
- La cuota gratuita de Gemini limita escaneos simultáneos (hay fallback local, pero el efecto wow es menor).
- Sin analítica: hoy no puedes saber de dónde llega nadie (solo el proxy del ranking).
- Marca en cero: nadie repite un dominio que no recuerda.

---

## 2. Posicionamiento: el mensaje

No vendas "música generativa desde una URL" (abstracto). Vende el momento:

> **Pitch (ES):** «Pega la URL de tu web y escucha cómo suena. vibedom lee su paleta, su tipografía
> y su movimiento y sintetiza su banda sonora en tu navegador. Sin samples, sin registro, sin subir nada.»
>
> **Pitch (EN):** "Paste your site's URL and hear what it sounds like. vibedom reads its palette,
> type and motion and synthesises its soundtrack in your browser. No samples, no sign-up, nothing to upload."

Jerarquía del mensaje (usa este orden en todo material):

1. **Demo sensorial:** 10 s de pantalla + audio escaneando una web famosa.
2. **Diferenciador:** la música se crea en tu navegador; la web no se queda con nosotros.
3. **Profundidad:** semilla sonora, playground, widget, ranking, exportar/importar.
4. **Técnica (para el público dev):** Tone.js, Web Audio, semilla JSON, widget < 5 KB en Shadow DOM.

A quién habla cada registro:

| Audiencia | Gancho | Canal |
| --- | --- | --- |
| Diseñadores/estudios web | «Dale identidad sonora a tus proyectos» | Framer/Webflow, LinkedIn, foros de diseño |
| Devs y creative coders | «Cómo convertir CSS en música con Web Audio» | Show HN, r/webdev, r/creativecoding, Dev.to |
| Curiosos de internet | «¿A qué suena la web de Nike?» | r/InternetIsBeautiful, X, TikTok/Reels |
| Agencias y freelance | «Añade a tu presupuesto un paquete de sonificación» | Email directo, LinkedIn |

---

## 3. El activo central: el "sound test" compartible

Todo el marketing gira sobre un formato repetible que ya tienes:

`sound test de <marca famosa>` = pantalla con la paleta adoptada + audio + tarjeta visual
(`/api/share-image` ya genera la imagen 1200×630 de la semilla).

Recetas concretas:

1. **Video corto (15–30 s, vertical y cuadrado):** pantalla con la URL pegándose, el espectro
   desplegándose, 8 s de audio, texto del "vibe detectado". Pie: «Pruébalo con tu web → vibedom.dev».
2. **Hilo de X/Bluesky:** 5 webs conocidas, 5 audios, 5 tarjetas. Pregunta final: «¿cuál suena mejor?».
3. **El ranking como cita recurrente:** «Esta semana en vibedom: lo más escuchado». Semanal,
   5 minutos, contenido infinito mientras haya escaneos.
4. **Piña propia:** fechas del sector, rediseños famosos, lanzamientos (el rediseño público de una web conocida es un sound test oportuno).

Regla de oro: **audio siempre con autoplay visible en el vídeo** (el producto suena; si el vídeo
no suena, no vende). Grabar con Playwright ya montado en `/tmp` (está hecho para el README).

---

## 4. Canales, por orden de prioridad

### A. Lanzamiento coordinado (una sola semana, máx. alcance)

1. **Product Hunt** (martes o jueves, 00:01 PT):
   - Tagline: *"What does your website sound like?"* — es la pregunta que engancha.
   - Galería: el GIF del README + 2 capturas del playground + tarjeta del widget.
   - **Preparar 20–30 upvotes reales el primer día** (contactos personales, lista de correo propia).
   - Responder todos los comentarios con el tono técnico del README (allí funciona el detalle
     "cero samples, cero backend de audio").
2. **Show HN** el mismo día:
   - Título: *Show HN: vibedom – Turn any website's design into generative music in your browser*
   - Primer comentario propio: la historia técnica (SSRF guard, fallback sin IA, widget < 5 KB,
     semilla determinista). HN compra honestidad: incluye el límite de Render free y por qué.
3. **Reddit** (mismo día, cuentas con historia previa, nunca 4 a la vez):
   - r/InternetIsBeautiful: «I built a tool that turns any website into music — here's Stripe's» (enlace a la landing, no al repo).
   - r/creativecoding y r/webaudio: el enfoque técnico.
   - r/webdev: el enfoque "feedback on my side project".
4. **X/LinkedIn/Bluesky:** hilo del "sound test" + respuesta al HN/PH por separado con enlaces.

### B. Distribución continua (semanal)

- **Newsletter indies:** Pointer, Bytes of Dev, El Output (ES), Sidebar.io. Plantilla de pitching abajo.
- **Comunidades:** Slack de Web Audio, foros de Framer y Webflow, Discord de Tone.js.
- **SEO ya cubierto:** vigilar Search Console (la propiedad EN sigue pendiente) y las
  búsquedas "what does my website sound like" (frase long-tail que tienes 100 % optimizada).
- **Reproducción orgánica del widget:** cada embed deja un enlace a vibedom.dev en la página
  anfitriona. Impulsarlo con una guía "cómo instalar" en video 60 s.

### C. Partners

- Creative coders de YouTube (es, en): ofrecer el playground en un vídeo colaborativo.
- Agencias pequeñas y freelancers: 2 correos/semana (plantilla abajo) durante 4 semanas.

---

## 5. Conversión de la visita

El producto convierte solo (el escaneo es gratis y anónimo), pero conviene acompañar cada salto:

1. **Visitante → usuario recurrente:** ranking (ya está), historial local (desde hoy),
   presets instantáneos sin backend. Nada más que tocar hoy.
2. **Usuario → prescriptor:** botón «Copiar enlace» ya embebe la semilla en la URL — hazlo
   visible en la landing tras un escaneo exitoso (hoy solo existe en el playground).
   Coste estimado: una clave i18n y un botón. Mayor multiplicador posible de todo el backlog.
3. **Usuario → cliente:** el widget es el producto "pagable". Plantear un plan freemium
   (Widget Pro con estilos propios, CDN dedicado o soporte comercial) cuando exista adopción
   real de embeds; medirlos añadiendo un contador simple de referer al `/api/scan`.

---

## 6. Medir sin traicionar la promesa de privacidad

Nada de cookies ni Google Analytics: contradice la promesa en el hero. Alternativas

| Señal | Cómo | Ya existe |
| --- | --- | --- |
| Escaneos/día y ráfagas | `/api/top` interno | Sí |
| Visitas sin cookies | Plausible self-hosted o Umami (sin cookies, propias) | No (aconsejado) |
| Embeds del widget | referer de peticiones a `widget-player.js` | Logged (mirar logs Render) |
| Supervivencia del ranking | el histórico de escaneos ya es un proxy decente | Proxy |

Objetivos honestos para 90 días (desde ~0):
- 3.000 visitas totales, 1.200 escaneos, >200 semillas compartidas, 5 embeds reales.
- Un post en un medio/creator con >20k de audiencia.

---

## 7. Plan 30/60/90 días

**Días 1–30 — Preparación y lanzamiento**
1. Corregir los avisos de infra (Upstash ya reclamada o migrar; decidir Starter de Render:
   el cold start de 25 s mata el pico del lanzamiento — recomendado gastar los 7 USD/mes).
2. Analítica sin cookies (Umami/Plausible) instalada antes del lanzamiento.
3. Grabar 5 sound tests (Stripe, Apple, Wikipedia, tu web, una sorpresa).
4. Product Hunt + Show HN + Reddit en la misma semana.
5. Semana siguiente: 10 correos a newsletters, 5 partnerships.

**Días 31–60 — Contenido y retención**
1. Sound test semanal (lunes) + ranking semanal (viernes) en X/LinkedIn.
2. Botón «Copiar enlace» en la landing (multiplicador de prescripción).
3. Artículo de tutor "cómo hice vibedom" para Dev.to/Hacker Noon (ES+EN): transparencia como SEO.
4. Página "Sound tests" con los 10 sound tests famosos (SEO long-tail directo y compartible).

**Días 61–90 — Crecimiento compuesto**
1. Revisar métricas con el mismo criterio del cuadro anterior; repetir lo que salga.
2. Segunda oleada en nichos de diseño en español (Domestika, Foro Alfa) y en comunidades de freelance.
3. Pilotos con 3 agencias/freelancers (los correos del bloque anterior debieron contestar ya).
4. Decidir el Widget Pro con base en los embeds reales.

---

## 8. Copy-paste listo

**Show HN (EN):**

> Show HN: Turn any website into generative music in your browser
>
> I built a tool that reads a site's palette, typography and motion and turns them into a
> generative soundtrack. Everything is synthesised in the visitor's browser with Tone.js:
> no audio files, no accounts, no tracking. There's an embeddable widget (<5 KB, Shadow DOM),
> a playground with the raw "sound seed" JSON, and a public ranking of the most-listened sites.
> Try it with your own site: https://vibedom.dev

**Product Hunt tagline (EN):** _What does your website sound like?_ (la descripción corta del hero ya sirve).

**Post r/InternetIsBeauty (EN):**

> You know how every site has a "vibe"? I made a tool that literally listens to it. Paste a URL,
> it reads the design (colors, type, motion) and synthesises a soundtrack in your browser.
> No samples, no sign-up. I tried Stripe and it sounded like a neon chase scene.

**Email a newsletter (ES→adaptar idioma):**

> Asunto: ¿A qué suena una web?
> Hice vibedom: pegas la URL de cualquier web y sintetiza su "banda sonora" en el navegador
> (analiza paleta, tipografía y movimiento; cero samples, cero registro, código abierto).
> Hay demo en 10 segundos y una viralidad fácil: nadie ha oído nunca "sonar" a Nike.
> ¿Te encaja para [newsletter]? Te preparo material exclusivo o un sound test de tu propia web.

**Email a agencia/freelance (ES):**

> Asunto: Identidad sonora para presupuestos de (re)branding
> Hice vibedom: sonificación de marca a partir del diseño de cualquier web. El cliente pega su
> URL, escucha su identidad sonora y se lleva un botón (widget) de 5 KB que la reproduce en su
> web sin librerías pesadas. Sin licencias de audio ni stock: sonido procedural 100 % sintetizado.

---

## 9. Riesgos del plan

| Riesgo | Mitigación |
| --- | --- |
| Pico de tráfico del lanzamiento tumba Render free / agota Gemini | Subir a Starter esos días; el fallback local ya garantiza que "nunca se queda sin sonido"; el limitador global ya protege la cuota |
| Autoenvío masivo visible (Reddit anti-spam) | Cuentas con historia, dos subreddits por semana máximo, título con historia personal |
| "No entiendo para qué sirve" | Liderar SIEMPRE con el vídeo+audio; el texto es secundario |
| Coste IA fuera de control si algo se hace viral | Los topes duros ya existen (`SCAN_BUDGET`, limiter); revisar alertas de facturación de Google Cloud |

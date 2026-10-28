// Reproductor del widget. Se importa desde `widget.js` solo cuando el
// visitante pulsa el botón, junto con Tone.js desde el CDN. La semilla ya
// viene incrustada en el snippet: aquí no hay llamadas a la IA ni al backend.

import { configureContext, createSoundscape } from "./src/engine/soundscape.js";

const TONE_URL = "https://cdn.jsdelivr.net/npm/tone@15.1.22/+esm";

let Tone = null;

/**
 * Crea el soundscape y lo arranca. Debe llamarse dentro del gesto del usuario
 * (clic) para que el navegador permita el audio.
 */
export async function createPlayer(rawSeed) {
  if (!Tone) {
    Tone = await import(TONE_URL);
    // El contexto se crea dentro del gesto, igual que en el playground.
    configureContext(Tone);
  }
  await Tone.start();

  const engine = await createSoundscape(Tone, rawSeed);
  await engine.start();

  return {
    get isPlaying() {
      return engine.isPlaying;
    },
    start: () => engine.start(),
    stop: () => engine.stop(),
    dispose: () => engine.dispose(),
  };
}

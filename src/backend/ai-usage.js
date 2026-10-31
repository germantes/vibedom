// Consumo de la IA: tokens, llamadas y coste estimado del día.
//
// `/api/health` lo expone para no depender de la consola de Google Cloud.
// El cálculo es una estimación con las tarifas publicadas; los precios reales
// pueden cambiar y los créditos de Google no se descuentan aquí.
//
// Como el presupuesto de escaneos, el contador vive en memoria: un despliegue
// o un cold start lo pone a cero. Sirve para vigilar el gasto, no para
// facturarlo.

const DAY_MS = 24 * 60 * 60 * 1000;

/** USD por millón de tokens (entrada / salida). */
export const MODEL_PRICING = Object.freeze({
  "gemini-3.5-flash": { input: 1.5, output: 9 },
  "gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "gemini-3.6-flash": { input: 1.5, output: 7.5 },
});

function envRate(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

// Tarifas de reserva para modelos que no estén en la tabla (o si Google
// cambia de nombre). Se pueden ajustar sin tocar código.
const FALLBACK_INPUT = envRate("AI_INPUT_USD_PER_MTOK") ?? 1.5;
const FALLBACK_OUTPUT = envRate("AI_OUTPUT_USD_PER_MTOK") ?? 9;

function priceFor(model, pricing) {
  return pricing[model] ?? { input: FALLBACK_INPUT, output: FALLBACK_OUTPUT };
}

const round = (value, digits = 6) => Number(value.toFixed(digits));

export function createAiUsage({ now = Date.now, pricing = MODEL_PRICING } = {}) {
  let day = Math.floor(now() / DAY_MS);
  let calls = 0;
  let promptTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let usd = 0;
  const byModel = new Map();

  function rollover() {
    const today = Math.floor(now() / DAY_MS);
    if (today === day) return;
    day = today;
    calls = 0;
    promptTokens = 0;
    outputTokens = 0;
    totalTokens = 0;
    usd = 0;
    byModel.clear();
  }

  return {
    /**
     * Anota una respuesta facturable de la IA. Los campos ausentes en
     * `usageMetadata` cuentan como 0; nunca lanza.
     */
    record({ model = "unknown", promptTokens: input = 0, outputTokens: output = 0, totalTokens: total = 0 } = {}) {
      rollover();
      const inTokens = Math.max(0, Math.floor(Number(input) || 0));
      const outTokens = Math.max(0, Math.floor(Number(output) || 0));
      const allTokens = Math.max(0, Math.floor(Number(total) || 0)) || inTokens + outTokens;
      const price = priceFor(model, pricing);
      const cost = (inTokens * price.input + outTokens * price.output) / 1_000_000;

      calls += 1;
      promptTokens += inTokens;
      outputTokens += outTokens;
      totalTokens += allTokens;
      usd += cost;

      const current = byModel.get(model) ?? { calls: 0, promptTokens: 0, outputTokens: 0, usd: 0 };
      current.calls += 1;
      current.promptTokens += inTokens;
      current.outputTokens += outTokens;
      current.usd += cost;
      byModel.set(model, current);
    },

    /** Estado para `/api/health`: sin datos personales ni IPs. */
    snapshot() {
      rollover();
      return {
        calls,
        promptTokens,
        outputTokens,
        totalTokens,
        estimatedUsd: round(usd, 4),
        // Tarifa media aplicada, útil para detectar modelos inesperados.
        models: Object.fromEntries(
          [...byModel.entries()].map(([model, value]) => [
            model,
            {
              calls: value.calls,
              promptTokens: value.promptTokens,
              outputTokens: value.outputTokens,
              estimatedUsd: round(value.usd, 4),
            },
          ]),
        ),
        note: "Estimación en memoria desde el último arranque; no descuenta créditos.",
      };
    },
  };
}

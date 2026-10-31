import { test } from "node:test";
import assert from "node:assert/strict";

import { createAiUsage, MODEL_PRICING } from "../src/backend/ai-usage.js";

test("ai-usage suma tokens y estima el coste con la tarifa del modelo", () => {
  const usage = createAiUsage({ now: () => Date.UTC(2026, 9, 31, 10) });

  usage.record({ model: "gemini-3.5-flash", promptTokens: 2285, outputTokens: 355, totalTokens: 2640 });
  usage.record({ model: "gemini-3.5-flash-lite", promptTokens: 1000, outputTokens: 1000, totalTokens: 2000 });

  const snapshot = usage.snapshot();
  assert.equal(snapshot.calls, 2);
  assert.equal(snapshot.promptTokens, 3285);
  assert.equal(snapshot.outputTokens, 1355);
  assert.equal(snapshot.totalTokens, 4640);

  const flash = (2285 * MODEL_PRICING["gemini-3.5-flash"].input + 355 * MODEL_PRICING["gemini-3.5-flash"].output) / 1e6;
  const lite = (1000 * MODEL_PRICING["gemini-3.5-flash-lite"].input + 1000 * MODEL_PRICING["gemini-3.5-flash-lite"].output) / 1e6;
  assert.equal(snapshot.estimatedUsd, Number((flash + lite).toFixed(4)));
  assert.equal(snapshot.models["gemini-3.5-flash"].calls, 1);
  assert.equal(snapshot.models["gemini-3.5-flash-lite"].outputTokens, 1000);
});

test("ai-usage usa la tarifa de reserva para modelos desconocidos y tolera campos ausentes", () => {
  const usage = createAiUsage({ now: () => Date.UTC(2026, 9, 31, 10) });
  usage.record({ model: "modelo-nuevo", promptTokens: 1_000_000, outputTokens: 1_000_000 });
  const snapshot = usage.snapshot();

  assert.equal(snapshot.calls, 1);
  assert.equal(snapshot.totalTokens, 2_000_000);
  assert.ok(snapshot.estimatedUsd > 0);
  assert.equal(snapshot.models["modelo-nuevo"].calls, 1);

  usage.record({});
  assert.equal(usage.snapshot().calls, 2);
  assert.equal(usage.snapshot().models.unknown.promptTokens, 0);
});

test("ai-usage vuelve a cero al cambiar de día UTC", () => {
  let now = Date.UTC(2026, 9, 31, 23, 59);
  const usage = createAiUsage({ now: () => now });

  usage.record({ model: "gemini-3.5-flash", promptTokens: 100, outputTokens: 50 });
  assert.equal(usage.snapshot().calls, 1);

  now = Date.UTC(2026, 10, 1, 0, 1);
  const snapshot = usage.snapshot();
  assert.equal(snapshot.calls, 0);
  assert.equal(snapshot.promptTokens, 0);
  assert.equal(snapshot.estimatedUsd, 0);
  assert.deepEqual(snapshot.models, {});
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { GeminiError, translate } from "../src/backend/translator.js";

process.env.GEMINI_KEY = "test-key";

const SEED = JSON.parse(readFileSync(new URL("../presets/cyberpunk.json", import.meta.url), "utf8"));
const SIGNALS = { url: "https://studio.test", title: "Studio" };
const silent = { log() {}, warn() {}, error() {} };

function geminiOk(seed = SEED) {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(seed) }] } }],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function geminiError(status, message = "error") {
  return new Response(JSON.stringify({ error: { code: status, message } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fakeFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body, signal: options.signal });
    return handler({ url, body, call: calls.length });
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test("translate llama a Gemini 3.5 Flash con schema, thinking bajo y devuelve la semilla validada", async () => {
  const fetchImpl = fakeFetch(() => geminiOk());
  const seed = await translate(SIGNALS, { fetchImpl, key: "k", logger: silent });

  assert.deepEqual(seed, SEED);
  assert.equal(fetchImpl.calls.length, 1);
  const [{ url, body }] = fetchImpl.calls;
  assert.match(url, /gemini-3\.5-flash:generateContent/);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
  assert.ok(body.generationConfig.responseSchema);
  assert.match(body.contents[0].parts[0].text, /studio\.test/);
  assert.match(body.system_instruction.parts[0].text, /español/);
});

test("translate escribe la copia en el idioma de la página", async () => {
  const fetchImpl = fakeFetch(() => geminiOk());
  await translate(SIGNALS, { fetchImpl, key: "k", lang: "en", logger: silent });
  assert.match(fetchImpl.calls[0].body.system_instruction.parts[0].text, /inglés/);

  const fallback = fakeFetch(() => geminiOk());
  await translate(SIGNALS, { fetchImpl: fallback, key: "k", lang: "fr", logger: silent });
  assert.match(fallback.calls[0].body.system_instruction.parts[0].text, /español/);
});

test("translate reintenta un 503 y termina con éxito", async () => {
  const fetchImpl = fakeFetch(({ call }) => (call === 1 ? geminiError(503, "high demand") : geminiOk()));
  const seed = await translate(SIGNALS, { fetchImpl, key: "k", sleep: async () => {}, logger: silent });

  assert.deepEqual(seed, SEED);
  assert.equal(fetchImpl.calls.length, 2);
});

test("translate pasa al modelo de respaldo si el principal se agota", async () => {
  const fetchImpl = fakeFetch(({ url }) =>
    url.includes("gemini-3.5-flash:") ? geminiError(503, "high demand") : geminiOk(),
  );
  const seed = await translate(SIGNALS, {
    fetchImpl,
    key: "k",
    models: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
    sleep: async () => {},
    logger: silent,
  });

  assert.deepEqual(seed, SEED);
  assert.equal(fetchImpl.calls.length, 3); // 2 intentos del principal + 1 del respaldo
  assert.match(fetchImpl.calls.at(-1).url, /gemini-3\.5-flash-lite/);
});

test("translate no reintenta errores no recuperables y los reporta", async () => {
  const fetchImpl = fakeFetch(() => geminiError(400, "bad request"));
  await assert.rejects(
    translate(SIGNALS, { fetchImpl, key: "k", models: ["gemini-3.5-flash"], sleep: async () => {}, logger: silent }),
    (err) => {
      assert.ok(err instanceof GeminiError);
      assert.match(err.message, /No se pudo traducir/);
      assert.match(err.message, /Gemini 400/);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 1);
});

test("translate reintenta si Gemini devuelve JSON roto o una semilla inválida", async () => {
  const invalidSeed = structuredClone(SEED);
  invalidSeed.musicalParams.scale = "blues";

  const responses = [
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{no es json" }] } }] })),
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(invalidSeed) }] } }] })),
    geminiOk(),
  ];
  let call = 0;
  const fetchImpl = async () => responses[call++];

  const seed = await translate(SIGNALS, {
    fetchImpl,
    key: "k",
    models: ["gemini-3.5-flash"],
    attemptsPerModel: 3,
    sleep: async () => {},
    logger: silent,
  });

  assert.deepEqual(seed, SEED);
  assert.equal(call, 3);
});

test("translate aplica timeout por intento y aborta la petición", async () => {
  const fetchImpl = async (url, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });

  await assert.rejects(
    translate(SIGNALS, {
      fetchImpl,
      key: "k",
      models: ["gemini-3.5-flash"],
      attemptsPerModel: 1,
      attemptTimeoutMs: 20,
      totalTimeoutMs: 500,
      sleep: async () => {},
      logger: silent,
    }),
    /no respondió/,
  );
});

test("translate no reintenta un 429: detiene la cadena y devuelve retryAfter", async () => {
  const fetchImpl = fakeFetch(() =>
    new Response(
      JSON.stringify({
        error: {
          code: 429,
          message: "quota exceeded",
          details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "7s" }],
        },
      }),
      { status: 429, headers: { "content-type": "application/json" } },
    ),
  );

  await assert.rejects(
    translate(SIGNALS, {
      fetchImpl,
      key: "k",
      models: ["gemini-3.5-flash", "gemini-3.5-flash-lite"],
      attemptsPerModel: 2,
      sleep: async () => {},
      logger: silent,
    }),
    (err) => {
      assert.ok(err instanceof GeminiError);
      assert.equal(err.code, "RATE_LIMITED");
      assert.equal(err.retryAfter, 7);
      assert.equal(err.retryable, false);
      return true;
    },
  );

  // Ni reintentos ni modelos de respaldo: la cuota es del proyecto.
  assert.equal(fetchImpl.calls.length, 1);
});

test("translate lee Retry-After de la cabecera cuando Gemini no manda RetryInfo", async () => {
  const fetchImpl = fakeFetch(
    () =>
      new Response(JSON.stringify({ error: { code: 429, message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "12" },
      }),
  );

  await assert.rejects(
    translate(SIGNALS, { fetchImpl, key: "k", models: ["gemini-3.5-flash"], sleep: async () => {}, logger: silent }),
    (err) => err.code === "RATE_LIMITED" && err.retryAfter === 12,
  );
});

test("translate pasa por el limitador global y enfría la cola tras un 429", async () => {
  const cooldowns = [];
  let runs = 0;
  const limiter = {
    run: async (task) => {
      runs += 1;
      return task();
    },
    cooldown: (seconds) => cooldowns.push(seconds),
  };
  const fetchImpl = fakeFetch(() =>
    new Response(JSON.stringify({ error: { code: 429, message: "quota", details: [{ retryDelay: "9s" }] } }), {
      status: 429,
      headers: { "content-type": "application/json" },
    }),
  );

  await assert.rejects(
    translate(SIGNALS, { fetchImpl, key: "k", limiter, models: ["gemini-3.5-flash"], logger: silent }),
    (err) => err.code === "RATE_LIMITED",
  );

  assert.equal(runs, 1);
  assert.deepEqual(cooldowns, [9]);
});

test("translate convierte un rechazo del limitador en RATE_LIMITED", async () => {
  const limiter = {
    run: async () => {
      throw Object.assign(new Error("cola llena"), { code: "RATE_LIMITED", retryAfter: 15 });
    },
  };
  const fetchImpl = fakeFetch(() => geminiOk());

  await assert.rejects(
    translate(SIGNALS, { fetchImpl, key: "k", limiter, models: ["gemini-3.5-flash"], logger: silent }),
    (err) => {
      assert.ok(err instanceof GeminiError);
      assert.equal(err.code, "RATE_LIMITED");
      assert.equal(err.retryAfter, 15);
      assert.equal(err.status, 429);
      return true;
    },
  );
  assert.equal(fetchImpl.calls.length, 0);
});

test("translate respeta la cancelación externa", async () => {
  const controller = new AbortController();
  const fetchImpl = async () =>
    new Promise((_, reject) => {
      controller.signal.addEventListener("abort", () => reject(Object.assign(new Error("stop"), { name: "AbortError" })));
    });

  const promise = translate(SIGNALS, {
    fetchImpl,
    key: "k",
    signal: controller.signal,
    sleep: async () => {},
    logger: silent,
  });
  controller.abort(new Error("cancelado por el usuario"));

  await assert.rejects(promise, /cancelado por el usuario/);
});

test("translate comunica los tokens facturables con onUsage", async () => {
  const fetchImpl = fakeFetch(
    () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: JSON.stringify(SEED) }] } }],
          usageMetadata: { promptTokenCount: 2285, candidatesTokenCount: 355, totalTokenCount: 2640 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const calls = [];

  await translate(SIGNALS, {
    fetchImpl,
    key: "k",
    logger: silent,
    onUsage: (usage) => calls.push(usage),
  });

  assert.deepEqual(calls, [
    { model: "gemini-3.5-flash", promptTokens: 2285, outputTokens: 355, totalTokens: 2640 },
  ]);
});

test("translate no anota uso cuando la respuesta falla", async () => {
  const fetchImpl = fakeFetch(() => geminiError(503, "high demand"));
  const calls = [];

  await assert.rejects(
    translate(SIGNALS, {
      fetchImpl,
      key: "k",
      models: ["gemini-3.5-flash"],
      attemptsPerModel: 1,
      logger: silent,
      onUsage: (usage) => calls.push(usage),
    }),
  );
  assert.deepEqual(calls, []);
});

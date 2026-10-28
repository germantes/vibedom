import { test } from "node:test";
import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GeminiError, translate } from "../src/backend/translator.js";
import {
  createGeminiProvider,
  createVertexProvider,
  resolveEngine,
  resolveProvider,
  vertexEndpoint,
} from "../src/backend/providers.js";
import {
  createTokenSource,
  loadServiceAccount,
  parseServiceAccount,
  signJwt,
} from "../src/backend/vertex-auth.js";
import { loadDotEnv } from "../src/backend/dotenv.js";

const SEED = JSON.parse(readFileSync(new URL("../presets/cyberpunk.json", import.meta.url), "utf8"));
const SIGNALS = { url: "https://studio.test", title: "Studio" };
const silent = { log() {}, warn() {}, error() {} };

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" });
const SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "vibedom",
  client_email: "vibedom-vertex@vibedom.iam.gserviceaccount.com",
  private_key: PRIVATE_PEM,
};

function seedResponse(seed = SEED) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(seed) }] } }] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function errorResponse(status, body) {
  return new Response(JSON.stringify(body ?? { error: { code: status, message: "error" } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** fetch falso que guarda URL, cabeceras y cuerpo de cada llamada. */
function recordingFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const contentType = options.headers?.["Content-Type"] ?? options.headers?.["content-type"] ?? "";
    const entry = {
      url: String(url),
      headers: options.headers ?? {},
      body: options.body && String(contentType).includes("application/json") ? JSON.parse(options.body) : options.body,
    };
    calls.push(entry);
    return handler(entry, calls.length);
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

// ---- Credenciales ----------------------------------------------------------

test("loadDotEnv carga el fichero sin pisar el entorno", () => {
  const dir = mkdtempSync(join(tmpdir(), "vibedom-env-"));
  const file = join(dir, ".env");
  writeFileSync(
    file,
    ['VIBEDOM_TEST_ENV_A=desde-fichero', 'VIBEDOM_TEST_ENV_B="con comillas"', "# comentario", ""].join("\n"),
  );
  process.env.VIBEDOM_TEST_ENV_A = "entorno";

  try {
    assert.equal(loadDotEnv(file), true);
    assert.equal(process.env.VIBEDOM_TEST_ENV_A, "entorno");
    assert.equal(process.env.VIBEDOM_TEST_ENV_B, "con comillas");
  } finally {
    delete process.env.VIBEDOM_TEST_ENV_A;
    delete process.env.VIBEDOM_TEST_ENV_B;
    rmSync(dir, { recursive: true, force: true });
  }

  assert.equal(loadDotEnv(join(tmpdir(), "no-existe-vibedom.env")), false);
});

test("signJwt firma un RS256 verificable con los claims que espera Google", () => {
  const now = () => 1_700_000_000_000;
  const jwt = signJwt({ clientEmail: SERVICE_ACCOUNT.client_email, privateKey: PRIVATE_PEM, now });
  const [header, payload, signature] = jwt.split(".");

  assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), { alg: "RS256", typ: "JWT" });
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
  assert.equal(claims.iss, SERVICE_ACCOUNT.client_email);
  assert.equal(claims.aud, "https://oauth2.googleapis.com/token");
  assert.equal(claims.scope, "https://www.googleapis.com/auth/cloud-platform");
  assert.equal(claims.exp - claims.iat, 3600);

  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${header}.${payload}`);
  verifier.end();
  assert.ok(verifier.verify(publicKey, Buffer.from(signature, "base64url")));
});

test("loadServiceAccount acepta base64, JSON inline y rechaza claves incompletas", () => {
  const encoded = Buffer.from(JSON.stringify(SERVICE_ACCOUNT)).toString("base64");
  assert.equal(loadServiceAccount({ VERTEX_SA_KEY_B64: encoded }).clientEmail, SERVICE_ACCOUNT.client_email);
  assert.equal(
    loadServiceAccount({ VERTEX_SA_KEY_JSON: JSON.stringify(SERVICE_ACCOUNT) }).projectId,
    "vibedom",
  );
  assert.equal(loadServiceAccount({}), null);
  assert.throws(() => parseServiceAccount(JSON.stringify({ type: "authorized_user" })), /service_account/);
  assert.throws(() => parseServiceAccount("{}"), /client_email/);
});

test("el token de OAuth se cachea y se reutiliza entre llamadas", async () => {
  let clock = 1_700_000_000_000;
  const fetchImpl = recordingFetch(() =>
    new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200 }),
  );
  const tokens = createTokenSource({ credentials: SERVICE_ACCOUNT, fetchImpl, now: () => clock });

  assert.equal(await tokens.get(), "tok-1");
  assert.equal(await tokens.get(), "tok-1");
  assert.equal(fetchImpl.calls.length, 1);
  assert.match(fetchImpl.calls[0].url, /oauth2\.googleapis\.com\/token/);

  clock += 3_600_000; // caducado
  fetchImpl.calls.length = 0;
  assert.equal(await tokens.get(), "tok-1");
  assert.equal(fetchImpl.calls.length, 1);
});

// ---- Proveedor Vertex ------------------------------------------------------

test("Vertex construye la URL regional y global del modelo", () => {
  assert.equal(
    vertexEndpoint({ project: "vibedom", location: "europe-west4", model: "gemini-3.5-flash" }),
    "https://europe-west4-aiplatform.googleapis.com/v1/projects/vibedom/locations/europe-west4/publishers/google/models/gemini-3.5-flash:generateContent",
  );
  assert.match(
    vertexEndpoint({ project: "vibedom", location: "global", model: "gemini-3.5-flash" }),
    /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/vibedom\/locations\/global\//,
  );
});

test("translate usa Vertex con Bearer, systemInstruction y el schema", async () => {
  const provider = createVertexProvider({
    project: "vibedom",
    location: "europe-west4",
    models: ["gemini-3.5-flash"],
    accessToken: "tok-vertex",
  });
  const fetchImpl = recordingFetch(() => seedResponse());

  const seed = await translate(SIGNALS, { fetchImpl, provider, logger: silent });

  assert.deepEqual(seed, SEED);
  const [{ url, headers, body }] = fetchImpl.calls;
  assert.match(url, /^https:\/\/europe-west4-aiplatform\.googleapis\.com\/v1\/projects\/vibedom\/locations\/europe-west4\/publishers\/google\/models\/gemini-3\.5-flash:generateContent$/);
  assert.equal(headers.Authorization, "Bearer tok-vertex");
  assert.ok(body.systemInstruction.parts[0].text);
  assert.equal(body.system_instruction, undefined);
  assert.equal(body.contents[0].role, "user");
  assert.ok(body.generationConfig.responseSchema);
  assert.equal(body.generationConfig.thinkingConfig.thinkingLevel, "low");
});

test("un 401 renueva el token y reintenta una sola vez", async () => {
  let generated = 0;
  const fetchImpl = recordingFetch((call) => {
    if (call.url.includes("oauth2.googleapis.com/token")) {
      generated += 1;
      return new Response(JSON.stringify({ access_token: `tok-${generated}`, expires_in: 3600 }), { status: 200 });
    }
    return generated === 1 ? errorResponse(401, { error: { code: 401, message: "token caducado" } }) : seedResponse();
  });

  const provider = createVertexProvider({
    project: "vibedom",
    location: "europe-west4",
    models: ["gemini-3.5-flash"],
    env: { VERTEX_SA_KEY_JSON: JSON.stringify(SERVICE_ACCOUNT) },
    fetchImpl,
  });

  const seed = await translate(SIGNALS, { fetchImpl, provider, logger: silent });
  assert.deepEqual(seed, SEED);
  const generations = fetchImpl.calls.filter((call) => call.url.includes(":generateContent"));
  assert.equal(generations.length, 2);
  assert.equal(generations[0].headers.Authorization, "Bearer tok-1");
  assert.equal(generations[1].headers.Authorization, "Bearer tok-2");
});

test("un 429 de Vertex enfría la cola y conserva el retryDelay", async () => {
  const provider = createVertexProvider({
    project: "vibedom",
    models: ["gemini-3.5-flash"],
    accessToken: "tok",
  });
  const fetchImpl = recordingFetch(() =>
    errorResponse(429, {
      error: {
        code: 429,
        message: "Quota exceeded",
        status: "RESOURCE_EXHAUSTED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.RetryInfo",
            retryDelay: "42s",
          },
        ],
      },
    }),
  );

  const cooled = [];
  const limiter = { run: (task) => task(), cooldown: (seconds) => cooled.push(seconds) };

  await assert.rejects(
    translate(SIGNALS, { fetchImpl, provider, limiter, logger: silent }),
    (err) => err instanceof GeminiError && err.code === "RATE_LIMITED" && err.retryAfter === 42,
  );
  assert.deepEqual(cooled, [42]);
  assert.equal(fetchImpl.calls.length, 1);
});

test("un 404 de Vertex no se reintenta: el modelo o la URL están mal", async () => {
  const provider = createVertexProvider({
    project: "vibedom",
    models: ["gemini-inexistente"],
    accessToken: "tok",
  });
  const fetchImpl = recordingFetch(() => errorResponse(404, { error: { code: 404, message: "model not found" } }));

  await assert.rejects(
    translate(SIGNALS, { fetchImpl, provider, logger: silent }),
    (err) => err.code === "ANALYSIS_FAILED" && /VERTEX_MODELS/.test(err.message),
  );
  assert.equal(fetchImpl.calls.length, 1);
});

// ---- Selección de motor ----------------------------------------------------

test("resolveEngine y resolveProvider eligen Vertex cuando hay proyecto", () => {
  const env = {
    VERTEX_PROJECT_ID: "vibedom",
    VERTEX_LOCATION: "global",
    VERTEX_MODELS: "gemini-3.5-flash, gemini-3.5-flash-lite",
    GEMINI_KEY: "irrelevante",
  };
  assert.equal(resolveEngine(env), "vertex");

  const provider = resolveProvider({ env, accessToken: "tok" });
  assert.equal(provider.name, "vertex");
  assert.equal(provider.project, "vibedom");
  assert.equal(provider.location, "global");
  assert.deepEqual(provider.models, ["gemini-3.5-flash", "gemini-3.5-flash-lite"]);

  assert.equal(resolveEngine({ GEMINI_KEY: "k" }), "gemini");
  assert.equal(resolveEngine({}), "local");
  assert.equal(resolveProvider({ env: { GEMINI_KEY: "k" } }).name, "gemini");
  assert.equal(createGeminiProvider({ key: "k" }).models.length, 3);
});

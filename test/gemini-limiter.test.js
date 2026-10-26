import { test } from "node:test";
import assert from "node:assert/strict";

import { createGeminiLimiter, GeminiLimiterError } from "../src/backend/gemini-limiter.js";

function fakeClock() {
  let time = 0;
  const sleeps = [];
  return {
    now: () => time,
    sleep: async (ms) => {
      sleeps.push(ms);
      time += ms;
    },
    advance: (ms) => {
      time += ms;
    },
    sleeps,
  };
}

test("serializa las llamadas y respeta el intervalo mínimo", async () => {
  const clock = fakeClock();
  const limiter = createGeminiLimiter({
    minIntervalMs: 8_000,
    maxWaitMs: 30_000,
    queueLimit: 5,
    now: clock.now,
    sleep: clock.sleep,
  });

  const starts = [];
  const task = (name) => async () => {
    starts.push({ name, at: clock.now() });
    clock.advance(500);
  };

  await Promise.all([limiter.run(task("a")), limiter.run(task("b")), limiter.run(task("c"))]);

  assert.deepEqual(starts, [
    { name: "a", at: 0 },
    { name: "b", at: 8_000 },
    { name: "c", at: 16_000 },
  ]);
  assert.deepEqual(clock.sleeps, [7_500, 7_500]);
  assert.equal(limiter.pending, 0);
});

test("el enfriamiento de un 429 se aplica a la siguiente llamada", async () => {
  const clock = fakeClock();
  const limiter = createGeminiLimiter({
    minIntervalMs: 1_000,
    maxWaitMs: 30_000,
    queueLimit: 5,
    now: clock.now,
    sleep: clock.sleep,
  });

  const starts = [];
  await limiter.run(async () => {
    starts.push(clock.now());
    limiter.cooldown(9);
  });
  await limiter.run(async () => {
    starts.push(clock.now());
  });

  // 9 s de enfriamiento > 1 s de intervalo mínimo.
  assert.deepEqual(starts, [0, 9_000]);
  assert.equal(limiter.cooldownSeconds, 0);
});

test("rechaza con RATE_LIMITED si la cola está llena", async () => {
  const clock = fakeClock();
  const limiter = createGeminiLimiter({
    minIntervalMs: 1_000,
    maxWaitMs: 30_000,
    queueLimit: 1,
    now: clock.now,
    sleep: clock.sleep,
  });

  let release;
  const running = limiter.run(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );

  await assert.rejects(limiter.run(async () => {}), (err) => {
    assert.ok(err instanceof GeminiLimiterError);
    assert.equal(err.code, "RATE_LIMITED");
    assert.ok(err.retryAfter >= 1);
    return true;
  });

  release();
  await running;
});

test("rechaza si la espera estimada supera maxWaitMs", async () => {
  const clock = fakeClock();
  const limiter = createGeminiLimiter({
    minIntervalMs: 10_000,
    maxWaitMs: 5_000,
    queueLimit: 5,
    now: clock.now,
    sleep: clock.sleep,
  });

  await limiter.run(async () => {});
  await assert.rejects(limiter.run(async () => {}), (err) => {
    assert.ok(err instanceof GeminiLimiterError);
    assert.equal(err.code, "RATE_LIMITED");
    assert.equal(err.retryAfter, 10);
    return true;
  });
});

test("las variables de entorno configuran el limitador", async () => {
  const previous = {
    min: process.env.GEMINI_MIN_INTERVAL_MS,
    max: process.env.GEMINI_MAX_WAIT_MS,
    queue: process.env.GEMINI_QUEUE_LIMIT,
  };
  process.env.GEMINI_MIN_INTERVAL_MS = "2500";
  process.env.GEMINI_MAX_WAIT_MS = "4000";
  process.env.GEMINI_QUEUE_LIMIT = "2";

  try {
    const clock = fakeClock();
    const limiter = createGeminiLimiter({ now: clock.now, sleep: clock.sleep });
    await limiter.run(async () => {});
    const starts = [];
    await limiter.run(async () => {
      starts.push(clock.now());
    });
    assert.equal(starts[0], 2_500);
  } finally {
    for (const [key, value] of [
      ["GEMINI_MIN_INTERVAL_MS", previous.min],
      ["GEMINI_MAX_WAIT_MS", previous.max],
      ["GEMINI_QUEUE_LIMIT", previous.queue],
    ]) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

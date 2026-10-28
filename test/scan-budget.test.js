import { test } from "node:test";
import assert from "node:assert/strict";

import { createScanBudget } from "../src/backend/scan-budget.js";

test("el tope global corta al llegar al límite y no cuenta los rechazos", () => {
  const budget = createScanBudget({ dailyLimit: 2, ipLimit: 100 });

  assert.equal(budget.take("a").ok, true);
  assert.equal(budget.take("b").ok, true);

  const denied = budget.take("c");
  assert.equal(denied.ok, false);
  assert.equal(denied.scope, "global");
  assert.ok(denied.retryAfter > 0);

  // El rechazo no consume: al reiniciarse el día quedan los dos de siempre.
  assert.deepEqual(budget.snapshot(), { usedToday: 2, dailyLimit: 2, perIpDailyLimit: 100 });
});

test("el tope por IP no afecta a otras IPs", () => {
  const budget = createScanBudget({ dailyLimit: 100, ipLimit: 1 });

  assert.equal(budget.take("1.2.3.4").ok, true);
  const denied = budget.take("1.2.3.4");
  assert.equal(denied.ok, false);
  assert.equal(denied.scope, "ip");

  assert.equal(budget.take("5.6.7.8").ok, true);
  assert.equal(budget.snapshot().usedToday, 2);
});

test("se reinicia a medianoche UTC", () => {
  let now = Date.parse("2026-01-01T23:59:00Z");
  const budget = createScanBudget({ dailyLimit: 1, ipLimit: 1, now: () => now });

  assert.equal(budget.take("ip").ok, true);
  assert.equal(budget.take("ip").ok, false);

  now = Date.parse("2026-01-02T00:00:01Z");
  const fresh = budget.take("ip");
  assert.equal(fresh.ok, true);
  assert.deepEqual(budget.snapshot(), { usedToday: 1, dailyLimit: 1, perIpDailyLimit: 1 });

  // El retryAfter apunta al final del día en curso, no a 24 h fijas.
  now = Date.parse("2026-01-02T23:00:00Z");
  const last = budget.take("ip");
  assert.equal(last.ok, false);
  assert.equal(last.retryAfter, 3600);
});

test("un límite 0 desactiva el tope", () => {
  const budget = createScanBudget({ dailyLimit: 0, ipLimit: 0 });

  for (let i = 0; i < 500; i += 1) assert.equal(budget.take("ip").ok, true);
  assert.equal(budget.snapshot().usedToday, 500);
});

test("el contador se mantiene dentro del día", () => {
  const now = Date.parse("2026-03-10T12:00:00Z");
  const budget = createScanBudget({ dailyLimit: 10, ipLimit: 10, now: () => now });

  budget.take("a");
  budget.take("a");
  budget.take("b");
  assert.deepEqual(budget.snapshot(), { usedToday: 3, dailyLimit: 10, perIpDailyLimit: 10 });
});

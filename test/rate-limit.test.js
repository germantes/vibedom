import { test } from "node:test";
import assert from "node:assert/strict";

import { clientIp, createRateLimiter } from "../src/backend/rate-limit.js";

const req = (headers = {}, remoteAddress = "203.0.113.7") => ({
  headers,
  socket: { remoteAddress },
});

test("clientIp prefiere Cloudflare y, si no, la última X-Forwarded-For", () => {
  const edge = { "x-forwarded-for": "1.1.1.1, 198.51.100.4" };
  assert.equal(
    clientIp(req({ "cf-connecting-ip": "203.0.113.10", "true-client-ip": "203.0.113.11", ...edge })),
    "203.0.113.10",
  );
  assert.equal(clientIp(req({ "true-client-ip": "203.0.113.11", ...edge })), "203.0.113.11");
  assert.equal(clientIp(req({ "cf-connecting-ip": ["203.0.113.12", "9.9.9.9"] })), "203.0.113.12");
  assert.equal(clientIp(req({ "cf-connecting-ip": "no-es-una-ip", ...edge })), "198.51.100.4");
  assert.equal(clientIp(req(edge)), "198.51.100.4");
  assert.equal(clientIp(req({ "x-forwarded-for": ["1.1.1.1", "198.51.100.5"] })), "198.51.100.5");
  assert.equal(clientIp(req()), "203.0.113.7");
});

test("la cuota separa clientes detrás del mismo edge de Cloudflare", () => {
  const check = createRateLimiter({ limit: 1, windowMs: 60_000, now: () => 0 });
  const headers = (ip) => ({
    "cf-connecting-ip": ip,
    "x-forwarded-for": "10.1.1.1, 198.51.100.9",
  });

  assert.equal(check(req(headers("203.0.113.10"))).ok, true);
  assert.equal(check(req(headers("203.0.113.10"))).ok, false);
  assert.equal(check(req(headers("203.0.113.11"))).ok, true);
});

test("el limitador permite hasta el límite y luego devuelve retryAfter", () => {
  let now = 0;
  const check = createRateLimiter({ limit: 2, windowMs: 60_000, now: () => now });
  const ip = req({ "x-forwarded-for": "198.51.100.4" });

  assert.equal(check(ip).ok, true);
  assert.equal(check(ip).ok, true);

  const blocked = check(ip);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.retryAfter, 60);

  now = 30_000;
  assert.equal(check(ip).retryAfter, 30);

  now = 60_000;
  assert.equal(check(ip).ok, true);
});

test("cada IP tiene su propia cuota y limit=0 la desactiva", () => {
  let now = 0;
  const check = createRateLimiter({ limit: 1, windowMs: 1000, now: () => now });

  assert.equal(check(req({ "x-forwarded-for": "198.51.100.4" })).ok, true);
  assert.equal(check(req({ "x-forwarded-for": "198.51.100.4" })).ok, false);
  assert.equal(check(req({ "x-forwarded-for": "198.51.100.5" })).ok, true);

  const unlimited = createRateLimiter({ limit: 0 });
  for (let i = 0; i < 50; i++) assert.equal(unlimited(req()).ok, true);
});

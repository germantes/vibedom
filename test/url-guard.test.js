import { test } from "node:test";
import assert from "node:assert/strict";

import { assertPublicUrl, isBlockedHostname, isPrivateIp, UnsafeUrlError } from "../src/backend/url-guard.js";

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("isPrivateIp reconoce rangos IPv4 reservados", () => {
  for (const ip of [
    "0.0.0.0",
    "10.1.2.3",
    "127.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.2.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "93.184.216.34", "172.32.0.1", "192.169.0.1"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("isPrivateIp reconoce rangos IPv6 reservados", () => {
  for (const ip of [
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1",
    "64:ff9b::7f00:1",
  ]) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001::1"]) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test("isBlockedHostname bloquea hosts locales por convención", () => {
  for (const host of ["localhost", "LOCALHOST", "app.localhost", "printer.local", "metadata.google.internal", "foo.test"]) {
    assert.equal(isBlockedHostname(host), true, host);
  }
  for (const host of ["example.com", "localhost.example.com", "notinternal.com"]) {
    assert.equal(isBlockedHostname(host), false, host);
  }
});

test("assertPublicUrl acepta destinos públicos y normaliza la URL", async () => {
  assert.equal(await assertPublicUrl("https://example.com/a?b=1", { lookupImpl: publicLookup }), "https://example.com/a?b=1");
  assert.equal(await assertPublicUrl("https://8.8.8.8/", { lookupImpl: publicLookup }), "https://8.8.8.8/");
  assert.equal(await assertPublicUrl("https://[2606:4700:4700::1111]/", { lookupImpl: publicLookup }), "https://[2606:4700:4700::1111]/");
});

test("assertPublicUrl rechaza protocolos, credenciales y hosts locales", async () => {
  const opts = { lookupImpl: publicLookup };
  await assert.rejects(assertPublicUrl("file:///etc/passwd", opts), UnsafeUrlError);
  await assert.rejects(assertPublicUrl("ftp://example.com", opts), /http o https/);
  await assert.rejects(assertPublicUrl("https://user:pass@example.com", opts), /credenciales/);
  await assert.rejects(assertPublicUrl("http://localhost/", opts), /locales/);
  await assert.rejects(assertPublicUrl("http://127.0.0.1:3000/", opts), /privadas/);
  await assert.rejects(assertPublicUrl("http://[::1]/", opts), /privadas/);
  await assert.rejects(assertPublicUrl("http://169.254.169.254/latest/meta-data", opts), /privadas/);
});

test("assertPublicUrl bloquea si el DNS resuelve a una IP privada", async () => {
  const privateLookup = async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.7", family: 4 },
  ];
  await assert.rejects(assertPublicUrl("https://rebind.example.com/", { lookupImpl: privateLookup }), /dirección privada/);
});

test("assertPublicUrl falla si el DNS no responde a tiempo", async () => {
  const never = () => new Promise(() => {});
  await assert.rejects(
    assertPublicUrl("https://slow.example.com/", { lookupImpl: never, lookupTimeoutMs: 10 }),
    /no se pudo resolver|a tiempo/i,
  );
});

test("allowPrivate deja pasar destinos locales (solo para desarrollo)", async () => {
  assert.equal(await assertPublicUrl("http://localhost:3000/", { allowPrivate: true }), "http://localhost:3000/");
});

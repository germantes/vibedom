import { test } from "node:test";
import assert from "node:assert/strict";
import { modulate, nextArpStep, nextDegree, usableDegrees, voiceLead, weightedPick } from "../src/engine/generative.js";
import { SCALES } from "../src/engine/scales.js";

/** RNG determinista (mulberry32) para que los tests sean reproducibles. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("weightedPick respeta los extremos del RNG y pesos cero", () => {
  assert.equal(weightedPick(["a", "b", "c"], [1, 0, 1], () => 0), "a");
  assert.equal(weightedPick(["a", "b", "c"], [1, 0, 1], () => 0.999), "c");
  assert.equal(weightedPick(["a", "b", "c"], [0, 1, 0], () => 0.5), "b");
});

test("los grados disminuidos se excluyen de la armonía", () => {
  assert.deepEqual(usableDegrees("major"), [0, 1, 2, 3, 4, 5]); // vii° fuera
  assert.deepEqual(usableDegrees("minor"), [0, 2, 3, 4, 5, 6]); // ii° fuera
  assert.deepEqual(usableDegrees("phrygian"), [0, 1, 2, 3, 5, 6]); // v° fuera
  assert.deepEqual(usableDegrees("lydian"), [0, 1, 2, 4, 5, 6]); // #iv° fuera
});

test("la progresión nunca repite acorde ni usa grados disminuidos", () => {
  for (const scale of Object.keys(SCALES)) {
    const rng = seeded(7);
    const allowed = usableDegrees(scale);
    let degree = 0;
    const visited = new Set();
    for (let i = 0; i < 500; i++) {
      const next = nextDegree(degree, scale, rng);
      assert.notEqual(next, degree, scale);
      assert.ok(allowed.includes(next), `${scale}: ${next}`);
      visited.add(next);
      degree = next;
    }
    assert.ok(visited.size >= allowed.length - 1, `${scale}: progresión pobre ${[...visited]}`);
  }
});

test("voice leading mantiene el acorde cerca del anterior", () => {
  const previous = [62, 65, 69, 72];
  const moved = voiceLead(previous, [67, 71, 74, 77].map((n) => n + 12));
  const center = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  assert.ok(Math.abs(center(moved) - center(previous)) <= 6, `${moved}`);
  assert.deepEqual([...moved].sort((a, b) => a - b), moved);
  assert.deepEqual(new Set(moved.map((n) => n % 12)), new Set([7, 11, 2, 5]));
});

test("el arpegio se queda dentro de su rango y gravita al acorde", () => {
  const rng = seeded(42);
  const opts = { scale: "minor", minStep: 7, maxStep: 20, chordSteps: [0, 2, 4] };
  let step = 10;
  let chordHits = 0;
  const N = 2000;
  for (let i = 0; i < N; i++) {
    step = nextArpStep(step, opts, rng);
    assert.ok(step >= 7 && step <= 20, `fuera de rango: ${step}`);
    if (opts.chordSteps.includes(step % 7)) chordHits++;
  }
  assert.ok(chordHits / N > 3 / 7 + 0.1, `gravedad débil: ${chordHits / N}`);
});

test("modulate: reposo = valor base, máximo = multiplicador", () => {
  assert.equal(modulate("filterFreq", 500, 0, 3), 500);
  assert.equal(modulate("filterFreq", 500, 1, 3), 1500);
  assert.equal(modulate("filterFreq", 500, 7, 3), 1500);
  assert.equal(modulate("reverbWet", 0.5, 0, 5), 0.5);
  assert.equal(modulate("reverbWet", 0.5, 1, 5), 1);
  assert.equal(modulate("arpDensity", 0.4, 1, 1), 0.4);
});

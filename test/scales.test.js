import { test } from "node:test";
import assert from "node:assert/strict";
import { chordForDegree, midiToNoteName, pitchClass, scaleMidi, scaleStepToMidi } from "../src/engine/scales.js";

const names = (midis) => midis.map(midiToNoteName);

test("pitchClass acepta sostenidos, bemoles y minúsculas", () => {
  assert.equal(pitchClass("C"), 0);
  assert.equal(pitchClass("eb"), 3);
  assert.equal(pitchClass("D#"), 3);
  assert.equal(pitchClass("Bb"), 10);
  assert.equal(pitchClass("Cb"), 11);
});

test("pitchClass rechaza notas inexistentes", () => {
  assert.throws(() => pitchClass("H"), RangeError);
  assert.throws(() => pitchClass("E#x"), RangeError);
  assert.throws(() => pitchClass(3), TypeError);
});

test("escalas desde la raíz en la octava pedida", () => {
  assert.deepEqual(names(scaleMidi("D", "phrygian", 3)), ["D3", "D#3", "F3", "G3", "A3", "A#3", "C4", "D4"]);
  assert.deepEqual(names(scaleMidi("F", "lydian", 3)), ["F3", "G3", "A3", "B3", "C4", "D4", "E4", "F4"]);
  assert.deepEqual(names(scaleMidi("G", "pentatonic", 3)), ["G3", "A3", "B3", "D4", "E4", "G4"]);
  assert.deepEqual(names(scaleMidi("A", "minor", 2)), ["A2", "B2", "C3", "D3", "E3", "F3", "G3", "A3"]);
});

test("grados negativos y más allá de la octava", () => {
  assert.equal(midiToNoteName(scaleStepToMidi(60, "major", -1)), "B3");
  assert.equal(midiToNoteName(scaleStepToMidi(60, "major", 9)), "E5");
  assert.equal(midiToNoteName(scaleStepToMidi(60, "pentatonic", 5)), "C5");
});

test("acordes diatónicos por terceras", () => {
  assert.deepEqual(names(chordForDegree("C", "major", 4, 0)), ["C4", "E4", "G4"]);
  assert.deepEqual(names(chordForDegree("C", "major", 4, 4, 4)), ["G4", "B4", "D5", "F5"]);
  assert.deepEqual(names(chordForDegree("A", "minor", 3, 5)), ["F4", "A4", "C5"]);
});

test("escala desconocida lanza", () => {
  assert.throws(() => scaleMidi("C", "blues", 3), RangeError);
});

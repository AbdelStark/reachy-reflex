/** Offline policy regression harness. Synthetic scenes only; no model or robot port. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ReflexPolicy } from "../dist/index.js";

const SCHEMA = "reflex.scene@1";
const FIELDS = new Set(["schema", "scene", "ms", "people", "target", "a", "speaker", "robot_speaking", "stale", "unavailable", "expect"]);
const OVERRIDES = new Set(["target_confidence", "addressed", "addressed_by_gaze", "ack", "ignored", "turn", "turn_confidence", "interrupt_probability", "engagement"]);
const PERSON = /^p[1-9]$/;
const probability = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;

function answers(row) {
  const a = row.a ?? {};
  if (!a || typeof a !== "object" || Array.isArray(a) || Object.keys(a).some((key) => !OVERRIDES.has(key))) throw new TypeError("invalid answer overrides");
  for (const [key, value] of Object.entries(a)) {
    if (key === "turn") {
      if (!["keep_talking", "yield", "interrupt"].includes(value)) throw new TypeError("invalid turn choice");
    } else if (key === "engagement") {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 4) throw new TypeError("invalid engagement");
    } else if (!probability(value)) throw new TypeError("invalid answer probability");
  }
  const noul = (value) => ({ noul: value });
  return {
    attention_target: { choice: row.target, confidence: a.target_confidence ?? 0.9 },
    addressed: noul(a.addressed ?? 0.2), addressed_by_gaze: noul(a.addressed_by_gaze ?? 0.2),
    wants_reply: noul(0.1), pause_invites_ack: noul(a.ack ?? 0.1),
    being_ignored: noul(a.ignored ?? 0.1), someone_leaving: noul(0.1), someone_arriving: noul(0.1),
    turn_action: { choice: a.turn ?? "keep_talking", confidence: a.turn_confidence ?? 0.9,
      ...(a.interrupt_probability !== undefined ? { probabilities: { interrupt: a.interrupt_probability } } : {}) },
    engagement: { score: a.engagement ?? 2 }, speaker_mood: { choice: "neutral", confidence: 0.8 },
    group_talking_to_each_other: noul(0.1), robot_named: noul(0.1), question_asked: noul(0.1),
    laughter_moment: noul(0.1), silence_awkward: noul(0.1),
  };
}

function input(row, line) {
  if (!row || typeof row !== "object" || Array.isArray(row) || row.schema !== SCHEMA || Object.keys(row).some((key) => !FIELDS.has(key))) throw new TypeError(`line ${line}: invalid scene schema`);
  if (typeof row.scene !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(row.scene) || !Number.isFinite(row.ms) || row.ms < 0) throw new TypeError(`line ${line}: invalid scene or time`);
  if (!Array.isArray(row.people) || row.people.length > 9 || row.people.some((person) => !Array.isArray(person) || person.length !== 2 || !PERSON.test(person[0]) || !Number.isFinite(person[1]) || Math.abs(person[1]) > 180)) throw new TypeError(`line ${line}: invalid people`);
  if (new Set(row.people.map((person) => person[0])).size !== row.people.length) throw new TypeError(`line ${line}: duplicate person`);
  if (typeof row.target !== "string" || (row.target !== "none" && !PERSON.test(row.target))) throw new TypeError(`line ${line}: invalid target`);
  if (row.speaker !== undefined && (!PERSON.test(row.speaker) || !row.people.some((person) => person[0] === row.speaker))) throw new TypeError(`line ${line}: invalid speaker`);
  for (const key of ["robot_speaking", "stale", "unavailable"]) if (row[key] !== undefined && typeof row[key] !== "boolean") throw new TypeError(`line ${line}: invalid flag`);
  if (row.unavailable && !row.stale) throw new TypeError(`line ${line}: unavailable must be stale`);
  const expected = row.expect;
  if (!expected || typeof expected !== "object" || Array.isArray(expected) || Object.keys(expected).sort().join() !== "events,gaze,idle,nod" || (expected.gaze !== "none" && !PERSON.test(expected.gaze)) || typeof expected.idle !== "boolean" || typeof expected.nod !== "boolean" || !Array.isArray(expected.events) || expected.events.some((event) => !["attention", "user_addressed", "yield", "interrupt"].includes(event))) throw new TypeError(`line ${line}: invalid expectation`);
  return {
    input: {
      nowMs: row.ms,
      people: row.people.map(([id, bearingDeg]) => ({ id, bearingDeg })),
      ...(row.speaker ? { mostRecentSpeaker: row.speaker } : {}),
      robotSpeaking: row.robot_speaking ?? false,
      stale: row.stale ?? false,
      ...(row.unavailable ? {} : { answers: answers(row) }),
    },
    expected,
  };
}

export function replayScenes(jsonl) {
  if (typeof jsonl !== "string" || Buffer.byteLength(jsonl) > 1_048_576) throw new TypeError("scene corpus exceeds 1 MiB");
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines.length > 2_000) throw new TypeError("scene corpus must have 1..2000 rows");
  let scene = "";
  let policy = new ReflexPolicy();
  let priorMs = -Infinity;
  const mismatches = [];
  const names = new Set();
  for (const [index, line] of lines.entries()) {
    let row;
    try { row = JSON.parse(line); } catch { throw new TypeError(`line ${index + 1}: invalid JSON`); }
    const { input: tick, expected } = input(row, index + 1);
    if (row.scene !== scene) {
      if (names.has(row.scene)) throw new TypeError(`line ${index + 1}: scene is not contiguous`);
      scene = row.scene;
      names.add(scene);
      policy = new ReflexPolicy();
      priorMs = -Infinity;
    }
    if (tick.nowMs <= priorMs) throw new TypeError(`line ${index + 1}: scene time is not increasing`);
    priorMs = tick.nowMs;
    const output = policy.step(tick);
    const actual = { gaze: output.gaze, nod: output.nod, idle: output.idle, events: output.events.map((event) => event.type) };
    if (actual.gaze !== expected.gaze || actual.nod !== expected.nod || actual.idle !== expected.idle
      || JSON.stringify(actual.events) !== JSON.stringify(expected.events)) {
      mismatches.push({ line: index + 1, scene, expected, actual });
    }
  }
  return { rows: lines.length, scenes: names.size, mismatches };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2];
    if (!path || process.argv.length !== 3) throw new TypeError("usage: node scripts/replay_scenes.mjs path/to/scenes.jsonl");
    const report = replayScenes(await readFile(path, "utf8"));
    console.log(`${report.rows} synthetic ticks across ${report.scenes} scenes; ${report.mismatches.length} mismatches`);
    if (report.mismatches.length) {
      console.error(JSON.stringify(report.mismatches, null, 2));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid scene corpus");
    process.exitCode = 2;
  }
}

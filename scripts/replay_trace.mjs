/** Replay exported policy decisions only. No model, camera, network, or robot port. */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ReflexPolicy } from "../dist/index.js";

const SCHEMA = "reflex.tick@2";
const PERSON = /^p[1-9]$/;
const NOUL_KEYS = [
  "addressed", "addressed_by_gaze", "wants_reply", "pause_invites_ack",
  "being_ignored", "someone_leaving", "someone_arriving",
  "group_talking_to_each_other", "robot_named", "question_asked",
  "laughter_moment", "silence_awkward",
];
const TARGET_KEYS = ["yawDeg", "pitchDeg", "rollDeg", "zMm", "leftAntennaDeg", "rightAntennaDeg"];
const isRecord = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const probability = (value) => finite(value) && value >= 0 && value <= 1;

function parseAnswers(value, line) {
  if (!isRecord(value) || !isRecord(value.attention_target) || !isRecord(value.turn_action)
    || !isRecord(value.speaker_mood) || !NOUL_KEYS.every((key) => probability(value[key]))
    || !probability(value.attention_target.confidence)
    || !(value.attention_target.choice === "none" || PERSON.test(value.attention_target.choice))
    || !["keep_talking", "yield", "interrupt"].includes(value.turn_action.choice)
    || !probability(value.turn_action.confidence)
    || (value.turn_action.interrupt_probability !== undefined && !probability(value.turn_action.interrupt_probability))
    || !finite(value.engagement) || value.engagement < 0 || value.engagement > 4
    || !["neutral", "curious", "playful", "tense", "frustrated"].includes(value.speaker_mood.choice)
    || !probability(value.speaker_mood.confidence)) {
    throw new TypeError(`line ${line}: invalid recorded answers`);
  }
  const nouls = Object.fromEntries(NOUL_KEYS.map((key) => [key, { noul: value[key] }]));
  return {
    attention_target: value.attention_target,
    ...nouls,
    turn_action: {
      choice: value.turn_action.choice,
      confidence: value.turn_action.confidence,
      ...(value.turn_action.interrupt_probability !== undefined
        ? { probabilities: { interrupt: value.turn_action.interrupt_probability } } : {}),
    },
    engagement: { score: value.engagement },
    speaker_mood: value.speaker_mood,
  };
}

function parseRow(value, line) {
  if (!isRecord(value) || value.schema !== SCHEMA
    || !Number.isSafeInteger(value.policy_epoch) || value.policy_epoch < 0
    || !finite(value.policy_clock_ms) || value.policy_clock_ms < 0
    || !Array.isArray(value.people) || value.people.length > 9
    || value.people.some((person) => !isRecord(person) || !PERSON.test(person.id)
      || !finite(person.bearing_deg) || Math.abs(person.bearing_deg) > 180)
    || new Set(value.people.map((person) => person.id)).size !== value.people.length
    || (value.most_recent_speaker !== undefined && !PERSON.test(value.most_recent_speaker))
    || typeof value.robot_speaking !== "boolean" || typeof value.stale !== "boolean"
    || !isRecord(value.decision) || !isRecord(value.decision.target)
    || !(value.decision.gaze === "none" || PERSON.test(value.decision.gaze))
    || typeof value.decision.nod !== "boolean" || typeof value.decision.idle !== "boolean"
    || !TARGET_KEYS.every((key) => finite(value.decision.target[key]))
    || !Array.isArray(value.decision.events)
    || value.decision.events.some((event) => !isRecord(event)
      || !["attention", "user_addressed", "yield", "interrupt"].includes(event.type)
      || (event.person !== undefined && !PERSON.test(event.person))
      || (event.p !== undefined && !probability(event.p)))) {
    throw new TypeError(`line ${line}: invalid trace row`);
  }
  if (!value.stale && value.answers === undefined) throw new TypeError(`line ${line}: fresh row has no answers`);
  return {
    epoch: value.policy_epoch,
    input: {
      nowMs: value.policy_clock_ms,
      people: value.people.map((person) => ({ id: person.id, bearingDeg: person.bearing_deg })),
      ...(value.most_recent_speaker ? { mostRecentSpeaker: value.most_recent_speaker } : {}),
      robotSpeaking: value.robot_speaking,
      stale: value.stale,
      ...(value.answers === undefined ? {} : { answers: parseAnswers(value.answers, line) }),
    },
    expected: {
      gaze: value.decision.gaze,
      nod: value.decision.nod,
      idle: value.decision.idle,
      events: value.decision.events.map((event) => ({
        type: event.type,
        ...(event.person !== undefined ? { person: event.person } : {}),
        ...(event.p !== undefined ? { p: event.p } : {}),
      })),
      target: Object.fromEntries(TARGET_KEYS.map((key) => [key, value.decision.target[key]])),
    },
  };
}

function sameDecision(actual, expected) {
  return actual.gaze === expected.gaze && actual.nod === expected.nod && actual.idle === expected.idle
    && JSON.stringify(actual.events) === JSON.stringify(expected.events)
    && TARGET_KEYS.every((key) => Math.abs(actual.target[key] - expected.target[key]) <= 1e-6);
}

/** A matching trace proves deterministic policy replay, not model or motor correctness. */
export function replayTrace(jsonl) {
  if (typeof jsonl !== "string" || Buffer.byteLength(jsonl) > 8 * 1024 * 1024) throw new TypeError("trace exceeds 8 MiB");
  const lines = jsonl.split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || lines.length > 1_200) throw new TypeError("trace must have 1..1200 rows");
  let policy = new ReflexPolicy();
  let epoch;
  let priorMs = -Infinity;
  let epochs = 0;
  const mismatches = [];
  for (const [index, line] of lines.entries()) {
    let value;
    try { value = JSON.parse(line); } catch { throw new TypeError(`line ${index + 1}: invalid JSON`); }
    const row = parseRow(value, index + 1);
    if (row.input.nowMs <= priorMs || (epoch !== undefined && row.epoch < epoch)) {
      throw new TypeError(`line ${index + 1}: trace time or policy epoch is not increasing`);
    }
    if (row.epoch !== epoch) {
      policy = new ReflexPolicy();
      epoch = row.epoch;
      epochs++;
    }
    priorMs = row.input.nowMs;
    const actual = policy.step(row.input);
    if (!sameDecision(actual, row.expected)) {
      mismatches.push({ line: index + 1, policy_epoch: row.epoch, expected: row.expected, actual });
    }
  }
  return { rows: lines.length, epochs, mismatches };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const path = process.argv[2];
    if (!path || process.argv.length !== 3) throw new TypeError("usage: node scripts/replay_trace.mjs path/to/reflex-trace.jsonl");
    const report = replayTrace(await readFile(path, "utf8"));
    console.log(`${report.rows} policy ticks across ${report.epochs} epochs; ${report.mismatches.length} mismatches`);
    if (report.mismatches.length) {
      console.error(JSON.stringify(report.mismatches, null, 2));
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "invalid trace");
    process.exitCode = 2;
  }
}

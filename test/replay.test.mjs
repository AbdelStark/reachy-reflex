import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { replayScenes } from "../scripts/replay_scenes.mjs";

const corpus = await readFile(new URL("../fixtures/replay_scenes.jsonl", import.meta.url), "utf8");

test("43 self-authored ticks lock gaze, nod, turn, stale, and ignored behavior", () => {
  const report = replayScenes(corpus);
  assert.deepEqual(report, { rows: 43, scenes: 4, mismatches: [] });
});

test("replay reports policy drift rather than regenerating golden expectations", () => {
  const rows = corpus.trim().split("\n");
  const changed = JSON.parse(rows[1]);
  changed.expect.gaze = "none";
  rows[1] = JSON.stringify(changed);
  const report = replayScenes(rows.join("\n"));
  assert.equal(report.mismatches.length, 1);
  assert.equal(report.mismatches[0].line, 2);
  assert.equal(report.mismatches[0].actual.gaze, "p1");
});

test("malformed and reordered scene data fail before use", () => {
  assert.throws(() => replayScenes("not JSON"), /invalid JSON/);
  const rows = corpus.trim().split("\n");
  const changed = JSON.parse(rows[1]);
  changed.ms = 0;
  rows[1] = JSON.stringify(changed);
  assert.throws(() => replayScenes(rows.join("\n")), /not increasing/);
  const altered = JSON.parse(rows[0]);
  altered.people = [["p1", -20], ["p1", 15]];
  assert.throws(() => replayScenes(JSON.stringify(altered)), /duplicate person/);
});

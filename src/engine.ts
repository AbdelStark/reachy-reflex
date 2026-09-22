import type { EntryType, Questions, TypeSafeClient } from "@typesafe-ai/sdk";
import { buildRoomState, JevClient, toTypeSafeQuestions, type JevAnswer, type JevResult, type RoomObservation } from "reachy-jev";
import { REFLEX_BANK } from "./bank.js";
import { ReflexPolicy, type ReflexAnswers, type ReflexOutput, type PersonId } from "./policy.js";
import { reflexPanelFrame, stalePanelFrame } from "./panel.js";
import type { PanelFrame } from "reachy-jev/panel";

function required(answers: Record<string, JevAnswer>, key: string, type: "noul" | "choice" | "score"): JevAnswer {
  const answer = answers[key];
  if (!answer || answer.type !== type) throw new TypeError(`missing or wrong Jev answer: ${key}`);
  return answer;
}
function p(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value) || value < 0 || value > 1) throw new TypeError("invalid probability");
  return value;
}
function parse(answers: Record<string, JevAnswer>, ids: readonly string[]): ReflexAnswers {
  const target = required(answers, "attention_target", "choice");
  const turn = required(answers, "turn_action", "choice");
  const mood = required(answers, "speaker_mood", "choice");
  const engagement = required(answers, "engagement", "score");
  if (!target.choice || (target.choice !== "none" && !ids.includes(target.choice)) || !turn.choice || !mood.choice || engagement.score === undefined || !Number.isFinite(engagement.score) || engagement.score < 0 || engagement.score > 4) throw new TypeError("incomplete or unknown choice or score");
  if (turn.probabilities && Object.values(turn.probabilities).some((value) => !Number.isFinite(value) || value < 0 || value > 1)) throw new TypeError("invalid choice distribution");
  if (!["keep_talking", "yield", "interrupt"].includes(turn.choice) || !["neutral", "curious", "playful", "tense", "frustrated"].includes(mood.choice)) throw new TypeError("unknown choice label");
  return {
    attention_target: { choice: target.choice as PersonId | "none", confidence: p(target.confidence) },
    addressed: { noul: p(required(answers, "addressed", "noul").noul) },
    addressed_by_gaze: { noul: p(required(answers, "addressed_by_gaze", "noul").noul) },
    wants_reply: { noul: p(required(answers, "wants_reply", "noul").noul) },
    pause_invites_ack: { noul: p(required(answers, "pause_invites_ack", "noul").noul) },
    being_ignored: { noul: p(required(answers, "being_ignored", "noul").noul) },
    someone_leaving: { noul: p(required(answers, "someone_leaving", "noul").noul) },
    someone_arriving: { noul: p(required(answers, "someone_arriving", "noul").noul) },
    turn_action: { choice: turn.choice as ReflexAnswers["turn_action"]["choice"], confidence: p(turn.confidence), ...(turn.probabilities ? { probabilities: turn.probabilities as Record<"keep_talking" | "yield" | "interrupt", number> } : {}) },
    engagement: { score: engagement.score },
    speaker_mood: { choice: mood.choice as ReflexAnswers["speaker_mood"]["choice"], confidence: p(mood.confidence) },
    group_talking_to_each_other: { noul: p(required(answers, "group_talking_to_each_other", "noul").noul) },
    robot_named: { noul: p(required(answers, "robot_named", "noul").noul) },
    question_asked: { noul: p(required(answers, "question_asked", "noul").noul) },
    laughter_moment: { noul: p(required(answers, "laughter_moment", "noul").noul) },
    silence_awkward: { noul: p(required(answers, "silence_awkward", "noul").noul) },
  };
}

/** Adapt the official SDK while keeping credentials and retry policy outside this library. */
export function typeSafeTransport(client: TypeSafeClient) {
  return async (state: unknown, questions: unknown) => {
    const result = await client.systemOne({ state: state as EntryType, questions: questions as Questions });
    return {
      model: result.model,
      usage: { input_tokens: result.usage.input_tokens, output_tokens: result.usage.output_tokens },
      answers: Object.fromEntries(Object.entries(result.answers).map(([key, answer]) => [key, { ...answer }])),
    };
  };
}

export interface EngineTick { output: ReflexOutput; panel: PanelFrame; answers?: ReflexAnswers; model?: string; latencyMs?: number; skipped?: boolean; stale: boolean; error?: string; requestFailed?: boolean }
export class ReflexEngine {
  private generation = 0;
  private awaitingFresh = false;
  constructor(private readonly client: JevClient, private policy = new ReflexPolicy()) {}
  /** Forget policy evidence when the observation or output authorization changes. */
  invalidate(): void {
    this.generation++;
    this.client.clear();
    this.policy = new ReflexPolicy();
    this.awaitingFresh = true;
  }
  async tick(observation: RoomObservation, nowMs: number): Promise<EngineTick | undefined> {
    const generation = this.generation;
    let prepared: {
      state: ReturnType<typeof buildRoomState>;
      ids: string[];
      questions: ReturnType<typeof toTypeSafeQuestions>;
    };
    try {
      if (!Number.isFinite(nowMs)) throw new RangeError("invalid time");
      const state = buildRoomState(observation);
      const ids = state.people.map((person) => person.id);
      prepared = { state, ids, questions: toTypeSafeQuestions(REFLEX_BANK, ids) };
    } catch (error) {
      this.invalidate();
      return {
        output: this.policy.step({ nowMs: Number.isFinite(nowMs) ? nowMs : 0, people: [], robotSpeaking: false, stale: true }),
        panel: stalePanelFrame(),
        stale: true,
        error: error instanceof Error ? error.name : "InvalidObservation",
      };
    }
    const { state, ids, questions } = prepared;
    const lastSpeaker = observation.transcriptRecent?.at(-1)?.who;
    const mostRecentSpeaker = lastSpeaker && /^p[1-9]$/.test(lastSpeaker) ? lastSpeaker as PersonId : undefined;
    const input = {
      nowMs,
      people: (observation.people ?? []).filter((person) => Number.isFinite(person.bearingDeg)).map((person) => ({ id: person.id as PersonId, bearingDeg: person.bearingDeg! })),
      ...(mostRecentSpeaker ? { mostRecentSpeaker } : {}),
      robotSpeaking: observation.robot?.currentlySpeaking ?? false,
    };
    let response: JevResult;
    try {
      response = await this.client.ask(state, questions);
    } catch (error) {
      if (generation !== this.generation) { this.client.clear(); return undefined; }
      return { output: this.policy.step({ ...input, stale: true }), panel: stalePanelFrame(), stale: true, error: error instanceof Error ? error.name : "JevError", requestFailed: true };
    }
    if (generation !== this.generation) { this.client.clear(); return undefined; }
    // A previously cached answer cannot seed a newly armed policy epoch.
    if (this.awaitingFresh && (response.skipped || response.stale)) return undefined;
    try {
      const answers = parse(response.answers, ids);
      const output = this.policy.step({ ...input, answers, stale: response.stale });
      if (this.awaitingFresh) this.awaitingFresh = false;
      return { output, panel: reflexPanelFrame(answers, { stale: response.stale, skipped: response.skipped, latencyMs: response.latencyMs, ...(response.model ? { model: response.model } : {}) }), answers, stale: response.stale, requestFailed: response.stale, ...(response.model ? { model: response.model } : {}), latencyMs: response.latencyMs, skipped: response.skipped };
    } catch (error) {
      return { output: this.policy.step({ ...input, stale: true }), panel: stalePanelFrame(response.model), stale: true, error: error instanceof Error ? error.name : "InvalidAnswer", requestFailed: true };
    }
  }
}

/** Bounded, opt-in, session-only evidence. No camera, audio, or transcript text. */

import type { RoomObservation } from "reachy-jev";
import type { EngineTick } from "./engine.js";
import type { ReflexAnswers } from "./policy.js";

export const TRACE_SCHEMA = "reflex.tick@1";
export const MAX_TRACE_ROWS = 1_200;
export type MotionOutcome = "preview" | "off" | "held" | "accepted" | "not_accepted" | "error";

const NOUL_KEYS = [
  "addressed", "addressed_by_gaze", "wants_reply", "pause_invites_ack",
  "being_ignored", "someone_leaving", "someone_arriving",
  "group_talking_to_each_other", "robot_named", "question_asked",
  "laughter_moment", "silence_awkward",
] as const;
const personId = (value: string): boolean => /^p[1-9]$/.test(value);
const motionOutcome = (value: string): value is MotionOutcome =>
  ["preview", "off", "held", "accepted", "not_accepted", "error"].includes(value);

function traceAnswers(answers: ReflexAnswers | undefined) {
  if (!answers) return undefined;
  return {
    attention_target: {
      choice: personId(answers.attention_target.choice) ? answers.attention_target.choice : "none",
      confidence: answers.attention_target.confidence,
    },
    ...Object.fromEntries(NOUL_KEYS.map((key) => [key, answers[key].noul])),
    turn_action: {
      choice: answers.turn_action.choice,
      confidence: answers.turn_action.confidence,
      ...(answers.turn_action.probabilities?.interrupt !== undefined
        ? { interrupt_probability: answers.turn_action.probabilities.interrupt } : {}),
    },
    engagement: answers.engagement.score,
    speaker_mood: { choice: answers.speaker_mood.choice, confidence: answers.speaker_mood.confidence },
  };
}

export interface TraceTick {
  schema: typeof TRACE_SCHEMA;
  elapsed_ms: number;
  policy_clock_ms: number;
  people: { id: string; bearing_deg: number }[];
  recent_text_present: boolean;
  most_recent_speaker?: string;
  robot_speaking: boolean;
  judgment_error: boolean;
  stale: boolean;
  skipped: boolean;
  model?: string;
  latency_ms?: number;
  answers?: ReturnType<typeof traceAnswers>;
  decision: {
    gaze: string;
    nod: boolean;
    idle: boolean;
    events: { type: string; person?: string; p?: number }[];
    target: { yawDeg: number; pitchDeg: number; rollDeg: number; zMm: number; leftAntennaDeg: number; rightAntennaDeg: number };
    motion: MotionOutcome;
  };
}

/** Keep at most five minutes of 4 Hz ticks in memory; nothing persists until export. */
export class SessionTrace {
  private rows: TraceTick[] = [];
  private startMs: number | undefined;

  get count(): number { return this.rows.length; }

  add(observation: RoomObservation, tick: EngineTick, nowMs: number, motion: MotionOutcome): void {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError("invalid trace time");
    if (!motionOutcome(motion)) throw new TypeError("invalid motion outcome");
    if (this.startMs !== undefined && nowMs < this.startMs) throw new RangeError("trace time went backward");
    this.startMs ??= nowMs;
    const target = tick.output.target;
    const row: TraceTick = {
      schema: TRACE_SCHEMA,
      elapsed_ms: Math.round(nowMs - this.startMs),
      policy_clock_ms: nowMs,
      people: (observation.people ?? []).filter((person) => personId(person.id) && Number.isFinite(person.bearingDeg)).slice(0, 9).map((person) => ({
        id: person.id,
        bearing_deg: person.bearingDeg!,
      })),
      recent_text_present: Boolean(observation.transcriptRecent?.length),
      ...(observation.transcriptRecent?.length && personId(observation.transcriptRecent.at(-1)!.who)
        ? { most_recent_speaker: observation.transcriptRecent.at(-1)!.who } : {}),
      robot_speaking: observation.robot?.currentlySpeaking === true,
      judgment_error: Boolean(tick.error),
      stale: tick.stale,
      skipped: tick.skipped === true,
      ...(tick.model && /^[A-Za-z0-9._:@/-]{1,80}$/.test(tick.model) ? { model: tick.model } : {}),
      ...(Number.isFinite(tick.latencyMs) ? { latency_ms: Math.round(tick.latencyMs!) } : {}),
      ...(tick.answers ? { answers: traceAnswers(tick.answers) } : {}),
      decision: {
        gaze: personId(tick.output.gaze) ? tick.output.gaze : "none",
        nod: tick.output.nod,
        idle: tick.output.idle,
        events: tick.output.events.map((event) => ({
          type: event.type,
          ...(event.person && personId(event.person) ? { person: event.person } : {}),
          ...(event.p !== undefined ? { p: event.p } : {}),
        })),
        target: {
          yawDeg: target.yawDeg, pitchDeg: target.pitchDeg, rollDeg: target.rollDeg,
          zMm: target.zMm, leftAntennaDeg: target.leftAntennaDeg, rightAntennaDeg: target.rightAntennaDeg,
        },
        motion,
      },
    };
    this.rows.push(row);
    if (this.rows.length > MAX_TRACE_ROWS) this.rows.shift();
  }

  toJSONL(): string {
    return this.rows.map((row) => JSON.stringify(row)).join("\n") + (this.rows.length ? "\n" : "");
  }

  clear(): void { this.rows = []; this.startMs = undefined; }
}

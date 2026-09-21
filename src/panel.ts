import type { PanelFrame } from "reachy-jev/panel";
import type { ReflexAnswers } from "./policy.js";

/** Display-only projection of answers that have already passed engine validation. */
export function reflexPanelFrame(
  answers: ReflexAnswers,
  meta: { model?: string; latencyMs?: number; skipped?: boolean; stale?: boolean } = {},
): PanelFrame {
  return {
    gauges: [
      { key: "attention", label: `Attention · ${answers.attention_target.choice}`, p: answers.attention_target.confidence, confidence: answers.attention_target.confidence, type: "choice" },
      { key: "addressed", label: "Addressed", p: answers.addressed.noul, type: "noul" },
      { key: "addressed_by_gaze", label: "Addressed by gaze", p: answers.addressed_by_gaze.noul, type: "noul" },
      { key: "pause_invites_ack", label: "Pause invites nod", p: answers.pause_invites_ack.noul, type: "noul" },
      { key: "being_ignored", label: "Being ignored", p: answers.being_ignored.noul, type: "noul" },
      { key: "turn_action", label: `Turn · ${answers.turn_action.choice}`, p: answers.turn_action.confidence, confidence: answers.turn_action.confidence, type: "choice" },
      { key: "engagement", label: "Engagement", p: answers.engagement.score / 4, type: "score" },
      { key: "speaker_mood", label: `Mood · ${answers.speaker_mood.choice}`, p: answers.speaker_mood.confidence, confidence: answers.speaker_mood.confidence, type: "choice" },
    ],
    ...meta,
  };
}

export function stalePanelFrame(model?: string): PanelFrame {
  return { gauges: [], stale: true, ...(model ? { model } : {}) };
}

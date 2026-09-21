import type { JevResponse } from "reachy-jev";

/** Deterministic UI fixture only. Never present this as a model answer. */
export async function fixtureAsk(state: unknown): Promise<JevResponse> {
  const room = state as { people?: { id: string }[]; transcript_recent?: { text: string }[] };
  const person = room.people?.[0]?.id;
  const addressed = room.transcript_recent?.at(-1)?.text.toLowerCase().includes("reachy") ? 0.9 : 0.2;
  const noul = (p: number) => ({ type: "noul" as const, noul: p });
  return {
    model: "fixture-only",
    answers: {
      attention_target: { type: "choice", choice: person ?? "none", confidence: person ? 0.87 : 0.99 },
      addressed: noul(addressed),
      addressed_by_gaze: noul(person ? 0.3 : 0.05),
      wants_reply: noul(addressed * 0.8),
      pause_invites_ack: noul(person ? 0.45 : 0.05),
      being_ignored: noul(person ? 0.15 : 0.8),
      someone_leaving: noul(0.07),
      someone_arriving: noul(person ? 0.75 : 0.04),
      turn_action: { type: "choice", choice: "keep_talking", confidence: 0.9 },
      engagement: { type: "score", score: person ? 2.5 : 0 },
      speaker_mood: { type: "choice", choice: "neutral", confidence: 0.8 },
      group_talking_to_each_other: noul(0.1),
      robot_named: noul(addressed),
      question_asked: noul(addressed * 0.9),
      laughter_moment: noul(0.03),
      silence_awkward: noul(0.1),
    },
  };
}

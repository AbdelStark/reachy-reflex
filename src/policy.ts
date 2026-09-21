import { attend, droop, engaged, Hysteresis, Refractory, type PoseTarget } from "reachy-jev";

export type PersonId = `p${number}`;
export interface Noul { noul: number }
export interface Choice<T extends string> { choice: T; confidence: number; probabilities?: Record<T, number> }
export interface Score { score: number; probabilities?: Record<string, number> }
export interface ReflexAnswers {
  attention_target: Choice<PersonId | "none">;
  addressed: Noul;
  addressed_by_gaze: Noul;
  wants_reply: Noul;
  pause_invites_ack: Noul;
  being_ignored: Noul;
  someone_leaving: Noul;
  someone_arriving: Noul;
  turn_action: Choice<"keep_talking" | "yield" | "interrupt">;
  engagement: Score;
  speaker_mood: Choice<"neutral" | "curious" | "playful" | "tense" | "frustrated">;
  group_talking_to_each_other: Noul;
  robot_named: Noul;
  question_asked: Noul;
  laughter_moment: Noul;
  silence_awkward: Noul;
}
export interface ReflexInput {
  nowMs: number;
  people: readonly { id: PersonId; bearingDeg: number; speaking?: boolean }[];
  mostRecentSpeaker?: PersonId;
  robotSpeaking: boolean;
  answers?: ReflexAnswers;
  stale: boolean;
}
export type ReflexEvent = { type: "user_addressed" | "yield" | "interrupt" | "attention"; person?: PersonId; p?: number };
export interface ReflexOutput { target: PoseTarget; gaze: PersonId | "none"; nod: boolean; events: ReflexEvent[]; idle: boolean }

const validP = (p: number) => Number.isFinite(p) && p >= 0 && p <= 1;
export class ReflexPolicy {
  private gaze: PersonId | "none" = "none";
  private gazeHysteresis = new Hysteresis<PersonId | "none">(2);
  private nodRefractory = new Refractory(3000);
  private lastNodHigh = false;
  private ignoredSince: number | undefined;
  private lastFresh: number | undefined;
  private lastAddressHigh = false;
  private lastAddressPerson: PersonId | undefined;
  private lastTurnEvent: "yield" | "interrupt" | undefined;
  private noTargetSince: number | undefined;
  private lastTarget: PoseTarget = attend(0);
  step(input: ReflexInput): ReflexOutput {
    if (!Number.isFinite(input.nowMs)) throw new RangeError("invalid time");
    const events: ReflexEvent[] = [];
    const answers = input.answers;
    const fresh = !input.stale && answers !== undefined;
    if (fresh) this.lastFresh = input.nowMs;
    const idle = !fresh && (this.lastFresh === undefined || input.nowMs - this.lastFresh >= 2000);
    if (!fresh && !idle) {
      return { target: this.lastTarget, gaze: this.gaze, nod: false, events, idle: false };
    }
    if (idle || !answers) {
      this.gaze = "none";
      this.gazeHysteresis.reset();
      this.lastNodHigh = false;
      this.lastAddressHigh = false;
      this.lastAddressPerson = undefined;
      this.lastTurnEvent = undefined;
      this.noTargetSince = undefined;
      this.lastTarget = { ...attend(25 * Math.sin(input.nowMs * 0.00016 * 2 * Math.PI)), pitchDeg: 0, zMm: 0 };
      return { target: this.lastTarget, gaze: "none", nod: false, events, idle: true };
    }
    const pAddress = answers.addressed.noul;
    const pGaze = answers.addressed_by_gaze.noul;
    const addressHigh = (validP(pAddress) && pAddress >= 0.7) || (validP(pGaze) && pGaze >= 0.8);
    if (fresh && addressHigh && input.mostRecentSpeaker && (!this.lastAddressHigh || this.lastAddressPerson !== input.mostRecentSpeaker) && input.people.some((p) => p.id === input.mostRecentSpeaker)) {
      this.gaze = input.mostRecentSpeaker;
      this.gazeHysteresis.reset();
      events.push({ type: "user_addressed", person: this.gaze, p: Math.max(pAddress, pGaze) });
      this.lastAddressPerson = input.mostRecentSpeaker;
    }
    this.lastAddressHigh = addressHigh;
    if (!addressHigh) this.lastAddressPerson = undefined;
    const candidate = answers.attention_target;
    const validTarget = validP(candidate.confidence) && candidate.confidence >= 0.6 && candidate.choice !== "none" && input.people.some((person) => person.id === candidate.choice);
    if (validTarget || addressHigh) this.noTargetSince = undefined;
    else this.noTargetSince ??= input.nowMs;
    if (fresh && validP(candidate.confidence) && candidate.confidence >= 0.6 && (candidate.choice === "none" || input.people.some((p) => p.id === candidate.choice))) {
      const stable = candidate.choice === "none" ? undefined : this.gazeHysteresis.step(candidate.choice);
      if (stable !== undefined && stable !== this.gaze) { this.gaze = stable; events.push({ type: "attention", ...(stable !== "none" ? { person: stable } : {}) }); }
    }
    const nodHigh = fresh && validP(answers.pause_invites_ack.noul) && answers.pause_invites_ack.noul >= 0.7;
    const nod = nodHigh && !this.lastNodHigh && !input.robotSpeaking && this.nodRefractory.fire(input.nowMs);
    this.lastNodHigh = nodHigh;
    let turnEvent: "yield" | "interrupt" | undefined;
    let turnP = 0;
    if (fresh && input.robotSpeaking && validP(answers.turn_action.confidence)) {
      if (answers.turn_action.choice === "yield" && answers.turn_action.confidence >= 0.7) {
        turnEvent = "yield";
        turnP = answers.turn_action.confidence;
      }
      const interruptP = answers.turn_action.probabilities?.interrupt ?? answers.turn_action.confidence;
      if (answers.turn_action.choice === "interrupt" && validP(interruptP) && interruptP >= 0.8) {
        turnEvent = "interrupt";
        turnP = interruptP;
      }
    }
    if (turnEvent && turnEvent !== this.lastTurnEvent) events.push({ type: turnEvent, p: turnP });
    this.lastTurnEvent = turnEvent;
    if (fresh && validP(answers.being_ignored.noul) && answers.being_ignored.noul >= 0.7 && !(validP(pAddress) && pAddress >= 0.5)) this.ignoredSince ??= input.nowMs;
    else this.ignoredSince = undefined;
    const ignored = this.ignoredSince !== undefined && input.nowMs - this.ignoredSince >= 20_000;
    if (ignored) {
      this.lastTarget = droop();
      return { target: this.lastTarget, gaze: "none", nod: false, events, idle: false };
    }
    if (this.noTargetSince !== undefined && input.nowMs - this.noTargetSince >= 3000) {
      this.gaze = "none";
      this.gazeHysteresis.reset();
      this.lastTarget = { ...attend(25 * Math.sin(input.nowMs * 0.00016 * 2 * Math.PI)), pitchDeg: 0, zMm: 0 };
      return { target: this.lastTarget, gaze: "none", nod: false, events, idle: true };
    }
    const person = input.people.find((p) => p.id === this.gaze);
    const gazePose = attend(person?.bearingDeg ?? 0);
    const engagement = Number.isFinite(answers.engagement.score) ? Math.max(0, Math.min(4, answers.engagement.score)) : 0;
    const engagePose = engaged(engagement);
    this.lastTarget = { ...gazePose, pitchDeg: gazePose.pitchDeg + engagePose.pitchDeg, zMm: gazePose.zMm + engagePose.zMm, rightAntennaDeg: engagePose.rightAntennaDeg, leftAntennaDeg: engagePose.leftAntennaDeg };
    return { target: this.lastTarget, gaze: this.gaze, nod, events, idle: false };
  }
}

import type { QuestionBank } from "reachy-jev";

/** Versioned together with room_state@1. Wording changes require a bank bump. */
export const REFLEX_BANK: QuestionBank = {
  bank: "reflex.core",
  version: "0.1.0",
  questions: {
    attention_target: { type: "choice", instructions: "Which person, if any, should the robot look at right now? Prefer someone speaking and facing the robot; otherwise someone near who spoke recently. Choose none when nobody is present or all are far and facing away.", options: ["$people.ids", "none"] },
    addressed: { type: "noul", instructions: "Is the most recent utterance in transcript_recent directed at the robot?", criteria: "True for Reachy by name, second-person address from someone facing the robot, or a question only it can answer. False for talk between people or reading aloud." },
    addressed_by_gaze: { type: "noul", instructions: "Ignoring transcript_recent, is a person turning to the robot to speak to it?", criteria: "True when a near person is facing_robot and speaking. False when speaking while facing away." },
    wants_reply: { type: "noul", instructions: "Does the most recent utterance expect the robot to answer in words?", criteria: "True for direct questions or requests to the robot. False for greetings, motion commands, or talk between people." },
    pause_invites_ack: { type: "noul", instructions: "Has the current speaker paused in a way a polite listener would acknowledge with a nod?", criteria: "True after a complete clause directed at the robot. False mid-sentence, for a question needing words, or while robot.currently_speaking is true." },
    being_ignored: { type: "noul", instructions: "Are all people present ignoring the robot?", criteria: "True when people are far or facing away and none has spoken to the robot recently. False when people is empty." },
    someone_leaving: { type: "noul", instructions: "Is a person leaving?", criteria: "True for moving walking, facing_robot false, and distance far. False without those observations." },
    someone_arriving: { type: "noul", instructions: "Has a new person just arrived?", criteria: "True when a person has seconds_since_last_spoke never and distance far or medium. False without a person." },
    turn_action: { type: "choice", instructions: "While robot.currently_speaking is true, should it keep talking, yield, or interrupt? Yield for a person starting to speak to the robot; interrupt only for an urgent stop or wait; otherwise keep talking.", options: ["keep_talking", "yield", "interrupt"] },
    engagement: { type: "score", instructions: "How engaged are the people with the robot right now? None means absent or silent and facing away; low means near but not facing; medium means facing and sometimes speaking; high means near, facing and asking questions; intense means several people addressing it quickly.", levels: ["none", "low", "medium", "high", "intense"] },
    speaker_mood: { type: "choice", instructions: "Which word best describes the mood of the most recent utterance? Curious asks to learn; playful jokes; tense is hurried; frustrated repeats a complaint; otherwise neutral.", options: ["neutral", "curious", "playful", "tense", "frustrated"] },
    group_talking_to_each_other: { type: "noul", instructions: "Are the people present talking to each other rather than to the robot?", criteria: "True when several people take turns and do not address Reachy." },
    robot_named: { type: "noul", instructions: "Does the most recent utterance in transcript_recent contain the robot's name?", criteria: "Reachy, Reachy Mini, Richie, or Reach-y count." },
    question_asked: { type: "noul", instructions: "Is the most recent utterance in transcript_recent a question?", criteria: "True for an interrogative or request for information regardless of who is addressed." },
    laughter_moment: { type: "noul", instructions: "Is the most recent utterance a joke or a moment where people are laughing?", criteria: "True for an obvious joke, teasing, or transcribed laughter." },
    silence_awkward: { type: "noul", instructions: "Is there an awkward silence after something was said to the robot?", criteria: "True when an utterance to the robot ended about 10 seconds ago or longer and the robot has not spoken since." },
  },
};

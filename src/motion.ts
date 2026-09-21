import { degToRad, rpyToMatrix } from "@pollen-robotics/reachy-mini-sdk";
import type { PoseTarget } from "reachy-jev";
import type { ReflexOutput } from "./policy.js";

export interface RobotMotionPort {
  state: string;
  setTarget(target: { head?: number[]; antennas?: number[] }): boolean;
  gotoTarget(target: { head?: number[]; antennas?: number[]; duration: number }): boolean;
}

export interface MotionEvidence {
  startedAtMs: number;
  deliveredAtMs: number;
  observedFrameAtMs: number;
  latestFrameAtMs: number;
  observedPeople: readonly { id: string; bearingDeg?: number }[];
  latestPeople: readonly { id: string; bearingDeg?: number }[];
}

/** A model answer may move the robot only while its camera-derived scene is still current. */
export function motionEvidenceCurrent(evidence: MotionEvidence): boolean {
  const { startedAtMs, deliveredAtMs, observedFrameAtMs, latestFrameAtMs, observedPeople, latestPeople } = evidence;
  if (![startedAtMs, deliveredAtMs, observedFrameAtMs, latestFrameAtMs].every(Number.isFinite)
    || observedFrameAtMs < 0 || observedFrameAtMs > startedAtMs || latestFrameAtMs < observedFrameAtMs
    || latestFrameAtMs > deliveredAtMs || deliveredAtMs < startedAtMs
    || startedAtMs - observedFrameAtMs > 500 || deliveredAtMs - latestFrameAtMs > 500
    || deliveredAtMs - startedAtMs > 750 || observedPeople.length !== latestPeople.length) return false;
  const latest = new Map(latestPeople.map((person) => [person.id, person.bearingDeg]));
  if (latest.size !== latestPeople.length || new Set(observedPeople.map((person) => person.id)).size !== observedPeople.length) return false;
  return observedPeople.every((person) => {
    const bearing = latest.get(person.id);
    return Number.isFinite(person.bearingDeg) && Number.isFinite(bearing)
      && Math.abs(person.bearingDeg! - bearing!) <= 8;
  });
}

/** Convert abstract targets only at the hardware boundary, with explicit app limits. */
export function toSdkTarget(pose: PoseTarget): { head: number[]; antennas: number[] } {
  const values = Object.values(pose);
  if (values.some((value) => !Number.isFinite(value))) throw new RangeError("non-finite pose");
  if (Math.abs(pose.yawDeg) > 45 || Math.abs(pose.pitchDeg) > 20 || Math.abs(pose.rollDeg) > 15 || Math.abs(pose.zMm) > 15
    || Math.abs(pose.rightAntennaDeg) > 35 || Math.abs(pose.leftAntennaDeg) > 35) throw new RangeError("pose exceeds Reflex app limits");
  const matrix = rpyToMatrix(pose.rollDeg, pose.pitchDeg, pose.yawDeg);
  matrix[2]![3] = pose.zMm / 1000;
  return { head: matrix.flat(), antennas: [degToRad(pose.rightAntennaDeg), degToRad(pose.leftAntennaDeg)] };
}

export class RobotMotionController {
  private enabled = false;
  private nodUntilMs = -Infinity;
  constructor(private readonly robot: RobotMotionPort) {}
  setEnabled(enabled: boolean): void { this.enabled = enabled; }
  apply(output: ReflexOutput, nowMs: number): boolean {
    if (!this.enabled || this.robot.state !== "streaming" || !Number.isFinite(nowMs)) return false;
    if (nowMs < this.nodUntilMs) return false;
    const base = toSdkTarget(output.target);
    if (output.nod) {
      const nodPose = { ...output.target, pitchDeg: Math.min(20, output.target.pitchDeg + 12) };
      const accepted = this.robot.gotoTarget({ ...toSdkTarget(nodPose), duration: 0.3 });
      if (accepted) this.nodUntilMs = nowMs + 500;
      return accepted;
    }
    return this.robot.setTarget(base);
  }
}

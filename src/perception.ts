import type { PersonObservation, RoomObservation } from "reachy-jev";

export interface FaceBox { x: number; y: number; width: number; height: number }
interface Track { id: string; box: FaceBox; seenAtMs: number }
const validBox = (box: FaceBox) => [box.x, box.y, box.width, box.height].every(Number.isFinite)
  && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0
  && box.x + box.width <= 1 && box.y + box.height <= 1;

export function overlap(a: FaceBox, b: FaceBox): number {
  if (!validBox(a) || !validBox(b)) throw new RangeError("invalid normalized face box");
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const width = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - left);
  const height = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - top);
  const intersection = width * height;
  return Math.max(0, Math.min(1, intersection / (a.width * a.height + b.width * b.height - intersection)));
}

/** Session-only IoU tracker. IDs are never identities and expire after 60 s. */
export class FaceTracker {
  private tracks: Track[] = [];
  constructor(private readonly horizontalFovDeg = 60) {
    if (!Number.isFinite(horizontalFovDeg) || horizontalFovDeg <= 0 || horizontalFovDeg > 180) throw new RangeError("invalid camera field of view");
  }
  update(boxes: readonly FaceBox[], nowMs: number): PersonObservation[] {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError("invalid timestamp");
    if (boxes.some((box) => !validBox(box))) throw new RangeError("invalid normalized face box");
    this.tracks = this.tracks.filter((track) => nowMs >= track.seenAtMs && nowMs - track.seenAtMs < 60_000);
    const detections = boxes.slice(0, 9);
    const matches = this.tracks.flatMap((track) => detections.map((box, index) => ({ id: track.id, index, iou: overlap(track.box, box) })))
      .filter(({ iou }) => iou >= 0.3)
      .sort((a, b) => b.iou - a.iou);
    const used = new Set<string>();
    const assigned = new Map<number, string>();
    for (const match of matches) {
      if (used.has(match.id) || assigned.has(match.index)) continue;
      assigned.set(match.index, match.id);
      used.add(match.id);
    }
    const next: Track[] = [];
    for (const [index, box] of detections.entries()) {
      let id = assigned.get(index);
      if (!id) {
        const free = Array.from({ length: 9 }, (_, index) => `p${index + 1}`).find((candidate) => !used.has(candidate) && !this.tracks.some((track) => track.id === candidate));
        if (!free) continue;
        id = free;
        used.add(id);
      }
      next.push({ id, box, seenAtMs: nowMs });
    }
    this.tracks = [...this.tracks.filter((track) => !used.has(track.id)), ...next];
    return next.map(({ id, box }) => ({
      id,
      bearingDeg: ((box.x + box.width / 2) - 0.5) * this.horizontalFovDeg,
      faceHeightFraction: box.height,
    }));
  }
  clear(): void { this.tracks = []; }
}

export class PerceptionState {
  private people: PersonObservation[] = [];
  private lastFrameAtMs = -Infinity;
  private readonly tracker: FaceTracker;
  constructor(horizontalFovDeg = 60) { this.tracker = new FaceTracker(horizontalFovDeg); }
  acceptFaces(boxes: readonly FaceBox[], nowMs: number): void {
    this.people = this.tracker.update(boxes, nowMs);
    this.lastFrameAtMs = nowMs;
  }
  snapshot(nowMs: number): RoomObservation {
    if (!Number.isFinite(nowMs) || nowMs < 0) throw new RangeError("invalid timestamp");
    // Never send or act on positions after a lost video stream.
    return { people: nowMs - this.lastFrameAtMs <= 1000 && nowMs >= this.lastFrameAtMs ? this.people : [] };
  }
  clear(): void { this.people = []; this.lastFrameAtMs = -Infinity; this.tracker.clear(); }
}

import type { FaceBox } from "./perception.js";

export interface PixelFaceBox { originX: number; originY: number; width: number; height: number }

/** Clip a detector rectangle to the actual frame before deriving its bearing. */
export function normalizeFaceBox(box: PixelFaceBox, frameWidth: number, frameHeight: number): FaceBox | undefined {
  if (![box.originX, box.originY, box.width, box.height, frameWidth, frameHeight].every(Number.isFinite)
    || box.width <= 0 || box.height <= 0 || frameWidth <= 0 || frameHeight <= 0) return undefined;
  if (!Number.isFinite(box.originX + box.width) || !Number.isFinite(box.originY + box.height)) return undefined;
  const left = Math.max(0, Math.min(frameWidth, box.originX));
  const top = Math.max(0, Math.min(frameHeight, box.originY));
  const right = Math.max(0, Math.min(frameWidth, box.originX + box.width));
  const bottom = Math.max(0, Math.min(frameHeight, box.originY + box.height));
  if (right <= left || bottom <= top) return undefined;
  const x = left / frameWidth;
  const y = top / frameHeight;
  const width = Math.min(1 - x, (right - left) / frameWidth);
  const height = Math.min(1 - y, (bottom - top) / frameHeight);
  return width > 0 && height > 0 ? { x, y, width, height } : undefined;
}

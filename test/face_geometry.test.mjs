import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFaceBox } from "../dist/face_geometry.js";
import { FaceTracker } from "../dist/perception.js";

test("face rectangles are clipped before normalized size and bearing are calculated", () => {
  const inside = normalizeFaceBox({ originX: 20, originY: 30, width: 40, height: 20 }, 100, 100);
  assert.deepEqual(inside, { x: 0.2, y: 0.3, width: 0.4, height: 0.2 });

  const left = normalizeFaceBox({ originX: -10, originY: 10, width: 20, height: 20 }, 100, 100);
  assert.deepEqual(left, { x: 0, y: 0.1, width: 0.1, height: 0.2 });
  assert.ok(Math.abs(new FaceTracker(60).update([left], 0)[0].bearingDeg + 27) < 1e-9);

  const right = normalizeFaceBox({ originX: 90, originY: 85, width: 20, height: 30 }, 100, 100);
  assert.equal(right.x, 0.9);
  assert.equal(right.y, 0.85);
  assert.ok(Math.abs(right.width - 0.1) < 1e-9);
  assert.equal(right.height, 0.15);
  assert.ok(Math.abs(new FaceTracker(60).update([right], 0)[0].bearingDeg - 27) < 1e-9);
});

test("fully outside and malformed detector boxes never enter the tracker", () => {
  const box = { originX: 100, originY: 10, width: 20, height: 20 };
  assert.equal(normalizeFaceBox(box, 100, 100), undefined);
  assert.equal(normalizeFaceBox({ ...box, originX: -20 }, 100, 100), undefined);
  assert.equal(normalizeFaceBox({ ...box, originX: 10, width: -1 }, 100, 100), undefined);
  assert.equal(normalizeFaceBox({ ...box, originX: Number.NaN }, 100, 100), undefined);
  assert.equal(normalizeFaceBox({ ...box, originX: 1e308, width: 1e308 }, 100, 100), undefined);
  assert.equal(normalizeFaceBox({ ...box, originX: 10 }, 0, 100), undefined);
});

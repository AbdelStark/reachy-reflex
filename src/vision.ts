import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";
import type { FaceBox } from "./perception.js";
import { normalizeFaceBox } from "./face_geometry.js";

// Build and dev server verify the upstream model hash, then serve it locally.
// Neither model nor Wasm is fetched from a third-party origin at browser runtime.
const MODEL_URL = "/mediapipe/face_detector.tflite";

export class VideoFaceDetector {
  private constructor(private readonly detector: FaceDetector) {}
  static async create(): Promise<VideoFaceDetector> {
    const fileset = await FilesetResolver.forVisionTasks(new URL("/mediapipe/wasm", location.origin).href);
    const detector = await FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
      runningMode: "VIDEO",
      minDetectionConfidence: 0.5,
    });
    return new VideoFaceDetector(detector);
  }
  detect(video: HTMLVideoElement, timestampMs: number): FaceBox[] {
    if (!video.videoWidth || !video.videoHeight || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return [];
    return this.detector.detectForVideo(video, timestampMs).detections.flatMap(({ boundingBox }) => {
      if (!boundingBox) return [];
      const box = normalizeFaceBox(boundingBox, video.videoWidth, video.videoHeight);
      return box ? [box] : [];
    });
  }
  close(): void { this.detector.close(); }
}

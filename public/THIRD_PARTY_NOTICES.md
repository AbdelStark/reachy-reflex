# Third-party notices for Reachy Reflex

Reachy Reflex's own source is MIT-licensed; see the repository's `LICENSE`.
The built browser app also contains or serves these separately licensed assets:

## MediaPipe Tasks Vision

- Package: `@mediapipe/tasks-vision` 1.0.1, including its browser JavaScript and locally served WebAssembly files.
- Author: The MediaPipe Authors / Google.
- License: Apache License 2.0. [Full license text](licenses/Apache-2.0.txt).
- Source: <https://github.com/google-ai-edge/mediapipe>.
- Package declaration: <https://www.npmjs.com/package/@mediapipe/tasks-vision>.

## BlazeFace short-range face detector

- Asset: `mediapipe/face_detector.tflite`, fetched at build time from Google's [versioned model URL](https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite).
- SHA-256: `b4578f35940bf5a1a655214a1cce5cab13eba73c1297cd78e1a04c2380b0152f`. The build fails if the downloaded bytes differ.
- Creator: Valentin Bazarevsky, Google, as identified by the [Google model card](https://storage.googleapis.com/mediapipe-assets/MediaPipe%20BlazeFace%20Model%20Card%20%28Short%20Range%29.pdf).
- License: Apache License 2.0, as stated in that model card. [Full license text](licenses/Apache-2.0.txt).

The model card describes intended use and limitations; it does not establish face-tracking accuracy for Reachy Mini. MediaPipe's [privacy notice](https://github.com/google-ai-edge/mediapipe#privacy-notice) also applies when the vision task is initialized.

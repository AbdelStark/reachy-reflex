"""Static optional-runtime API check; no weights, microphone, or robot."""

from inspect import signature

from faster_whisper import WhisperModel


def main() -> None:
    constructor = signature(WhisperModel.__init__).parameters
    transcribe = signature(WhisperModel.transcribe).parameters
    if (
        "local_files_only" not in constructor
        or "condition_on_previous_text" not in transcribe
    ):
        raise SystemExit("installed faster-whisper lacks the required local ASR API")
    print("faster-whisper local model and transcript API available")


if __name__ == "__main__":
    main()

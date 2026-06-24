#!/usr/bin/env python3
"""
Preprocess each reference video into a structured analysis bundle.

Per video, writes style-analysis/preproc/<name>/:
  shots.json          shot boundaries with start/end seconds
  shot_NN.jpg         one keyframe per shot (mid-shot)
  hook_NN.jpg         dense 2fps frames covering first 5 seconds
  transcript.json     Whisper word-level transcript
  beats.json          librosa beat tracking + tempo
  transitions.json    rough transition type per cut (hard / fade / motion)
  pacing_curve.json   cuts-per-second over time
  meta.json           combined index + ffprobe info

This is the "look at the video like an editor" pass. After this runs,
the Workflow fans out vision agents that read these JPEGs + JSONs.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "style-analysis" / "references"
OUT_BASE = ROOT / "style-analysis" / "preproc"
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".mkv"}


def ffprobe_meta(path: Path) -> dict:
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-print_format", "json",
         "-show_streams", "-show_format", str(path)],
        text=True,
    )
    data = json.loads(out)
    v = next((s for s in data["streams"] if s["codec_type"] == "video"), None)
    a = next((s for s in data["streams"] if s["codec_type"] == "audio"), None)
    if not v:
        return {}
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    return {
        "duration": float(data["format"]["duration"]),
        "fps": num / den if den else 30,
        "width": int(v["width"]),
        "height": int(v["height"]),
        "hasAudio": a is not None,
    }


def detect_shots(path: Path) -> list[dict]:
    from scenedetect import detect, ContentDetector

    scenes = detect(str(path), ContentDetector(threshold=27.0))
    return [
        {"index": i, "startSec": round(s[0].seconds, 3), "endSec": round(s[1].seconds, 3),
         "durationSec": round(s[1].seconds - s[0].seconds, 3)}
        for i, s in enumerate(scenes)
    ]


def extract_keyframe(path: Path, t_sec: float, out: Path) -> bool:
    out.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{t_sec:.3f}", "-i", str(path), "-frames:v", "1",
         "-vf", "scale=512:-2", "-q:v", "3", str(out)],
        capture_output=True,
    )
    return r.returncode == 0 and out.exists()


def extract_hook_frames(path: Path, dst_dir: Path, fps: float = 2.0, dur: float = 5.0) -> list[str]:
    dst_dir.mkdir(parents=True, exist_ok=True)
    pattern = dst_dir / "hook_%02d.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(path), "-t", str(dur), "-vf",
         f"fps={fps},scale=512:-2", "-q:v", "3", str(pattern)],
        capture_output=True,
    )
    return sorted(p.name for p in dst_dir.glob("hook_*.jpg"))


def transcribe(path: Path, dst: Path) -> dict | None:
    try:
        import whisper
    except ImportError:
        return None
    model = transcribe._model if hasattr(transcribe, "_model") else None
    if model is None:
        print("    [whisper] loading tiny model …")
        model = whisper.load_model("tiny")
        transcribe._model = model
    res = model.transcribe(str(path), word_timestamps=True, fp16=False, verbose=False)
    out = {
        "language": res.get("language"),
        "text": res.get("text", "").strip(),
        "segments": [
            {
                "start": round(s.get("start", 0), 3),
                "end": round(s.get("end", 0), 3),
                "text": s.get("text", "").strip(),
                "words": [
                    {"start": round(w.get("start", 0), 3),
                     "end": round(w.get("end", 0), 3),
                     "word": w.get("word", "").strip()}
                    for w in s.get("words", [])
                ],
            }
            for s in res.get("segments", [])
        ],
    }
    dst.write_text(json.dumps(out, indent=2))
    return out


def detect_beats(path: Path, dst: Path) -> dict | None:
    try:
        import librosa
    except ImportError:
        return None
    try:
        y, sr = librosa.load(str(path), sr=22050, mono=True)
    except Exception as e:
        return {"error": str(e)}
    if y.size == 0:
        return {"error": "empty audio"}
    import numpy as np

    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    onset_env = librosa.onset.onset_strength(y=y, sr=sr)
    onsets = librosa.onset.onset_detect(onset_envelope=onset_env, sr=sr, units="time")

    tempo_val = float(np.asarray(tempo).flatten()[0]) if np.asarray(tempo).size else 0.0

    out = {
        "tempoBpm": round(tempo_val, 1),
        "beatTimes": [round(float(t), 3) for t in librosa.frames_to_time(beats, sr=sr)],
        "onsetTimes": [round(float(t), 3) for t in onsets],
    }
    dst.write_text(json.dumps(out, indent=2))
    return out


def classify_transitions(path: Path, shots: list[dict], dst: Path) -> dict:
    """Cheap heuristic: sample 3 frames around each cut, measure mean abs diff.
    High diff = hard cut; gradual ramp = fade; mid + spatial shift = motion/whip."""
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened():
        return {"transitions": []}
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    transitions: list[dict] = []
    for s in shots[1:]:
        t = s["startSec"]
        samples = []
        for off in (-0.20, -0.05, 0.05, 0.20):
            cap.set(cv2.CAP_PROP_POS_MSEC, max(0, t + off) * 1000)
            ok, f = cap.read()
            if ok:
                samples.append(cv2.resize(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (96, 170)))
        if len(samples) < 3:
            continue
        diffs = [float(np.mean(np.abs(samples[i + 1].astype(int) - samples[i].astype(int))))
                 for i in range(len(samples) - 1)]
        max_d = max(diffs)
        is_gradual = all(d > 5 for d in diffs) and max(diffs) - min(diffs) < 8
        if is_gradual and max_d < 25:
            kind = "fade"
        elif max_d > 35:
            kind = "hard"
        else:
            kind = "motion"
        transitions.append({"atSec": t, "kind": kind, "maxDelta": round(max_d, 1)})
    cap.release()
    out = {"transitions": transitions,
           "counts": {k: sum(1 for t in transitions if t["kind"] == k) for k in ("hard", "fade", "motion")}}
    dst.write_text(json.dumps(out, indent=2))
    return out


def pacing_curve(shots: list[dict], duration: float, bin_sec: float = 3.0) -> dict:
    bins = max(1, int(duration / bin_sec))
    cuts_per_bin = [0] * bins
    for s in shots[1:]:
        b = min(bins - 1, int(s["startSec"] / bin_sec))
        cuts_per_bin[b] += 1
    return {
        "binSec": bin_sec,
        "cutsPerBin": cuts_per_bin,
        "cutsPerSec": [round(c / bin_sec, 3) for c in cuts_per_bin],
    }


def safe_name(stem: str) -> str:
    s = stem.replace(" ", "_")
    parts = s.rsplit("-pin-id-", 1)
    if len(parts) == 2 and parts[1]:
        return f"{parts[0][:50]}__pin{parts[1][:20]}"
    return s[:80]


def process(path: Path) -> dict:
    name = safe_name(path.stem)
    out_dir = OUT_BASE / name
    out_dir.mkdir(parents=True, exist_ok=True)
    print(f"\n→ {path.name}")

    meta = ffprobe_meta(path)
    print(f"  meta: {meta.get('duration'):.1f}s {meta.get('width')}x{meta.get('height')} fps={meta.get('fps'):.1f}")

    shots = detect_shots(path)
    (out_dir / "shots.json").write_text(json.dumps(shots, indent=2))
    print(f"  shots: {len(shots)}")

    keyframes: list[str] = []
    for s in shots:
        mid = (s["startSec"] + s["endSec"]) / 2
        kfp = out_dir / f"shot_{s['index']:02d}.jpg"
        if extract_keyframe(path, mid, kfp):
            keyframes.append(kfp.name)
    print(f"  keyframes: {len(keyframes)}")

    hook = extract_hook_frames(path, out_dir)
    print(f"  hook frames: {len(hook)}")

    print(f"  transcribing …", flush=True)
    transcript = transcribe(path, out_dir / "transcript.json")
    if transcript:
        print(f"    \"{transcript['text'][:80]}\"")
    else:
        print(f"    no whisper available")

    print(f"  beats …", flush=True)
    beats = detect_beats(path, out_dir / "beats.json")
    if beats and "tempoBpm" in beats:
        print(f"    tempo {beats['tempoBpm']} bpm, {len(beats['beatTimes'])} beats")

    print(f"  transitions …", flush=True)
    trans = classify_transitions(path, shots, out_dir / "transitions.json")
    print(f"    {trans.get('counts', {})}")

    pacing = pacing_curve(shots, meta.get("duration", 0))
    (out_dir / "pacing_curve.json").write_text(json.dumps(pacing, indent=2))

    summary = {
        "file": path.name,
        "name": name,
        "meta": meta,
        "shotCount": len(shots),
        "keyframes": keyframes,
        "hookFrames": hook,
        "transcript": (out_dir / "transcript.json").exists(),
        "beats": (out_dir / "beats.json").exists(),
        "transitions": trans.get("counts", {}),
        "pacing": pacing,
    }
    (out_dir / "meta.json").write_text(json.dumps(summary, indent=2))
    return summary


def main() -> None:
    OUT_BASE.mkdir(parents=True, exist_ok=True)
    files = sorted(p for p in REF_DIR.iterdir() if p.suffix.lower() in VIDEO_EXTS)
    if not files:
        print(f"No videos in {REF_DIR}")
        sys.exit(1)

    index = []
    for f in files:
        try:
            index.append(process(f))
        except Exception as e:
            print(f"  ! failed: {e}")
            import traceback; traceback.print_exc()

    (OUT_BASE / "index.json").write_text(json.dumps(index, indent=2))
    print(f"\n→ {OUT_BASE}/index.json — {len(index)} videos preprocessed")


if __name__ == "__main__":
    main()

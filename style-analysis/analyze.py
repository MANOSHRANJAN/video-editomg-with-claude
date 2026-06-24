#!/usr/bin/env python3
"""
Style fingerprint extractor.

Reads videos from style-analysis/references/ (your style targets) and
optionally from style-analysis/reels/ (anything yt-dlp downloads), runs:
  - ffprobe       -> duration / fps / resolution
  - PySceneDetect -> shot boundaries -> pacing
  - cv2 sampling  -> dominant colors per shot

Writes style-analysis/style.json with:
  - aggregate pacing (avg/median shot length, shots/sec)
  - color palette (top hex colors, mean brightness/saturation)
  - keywords[] (parsed from filenames; you can edit by hand)
  - perReel detail

Run inside the venv:
  ./.venv/bin/python style-analysis/analyze.py
"""

from __future__ import annotations

import json
import re
import statistics
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
REF_DIR = ROOT / "style-analysis" / "references"
REEL_DIR = ROOT / "style-analysis" / "reels"
OUT_PATH = ROOT / "style-analysis" / "style.json"

VIDEO_EXTS = {".mp4", ".mov", ".webm", ".m4v", ".mkv"}

STOP = {
    "from", "the", "a", "an", "of", "for", "to", "in", "on", "with", "and",
    "this", "that", "these", "your", "you", "youll", "youre", "klickpin", "com",
    "pin", "id", "want", "still", "result", "ideas", "looks", "build", "more",
    "fresh", "weekend", "diy", "starter", "obsessed", "beginner", "stylish",
    "recreate", "trending", "perfect", "beginners", "impressive", "no",
    "saving", "right", "now", "worth", "refresh", "routine", "to", "are", "who",
}


def list_videos() -> list[Path]:
    files: list[Path] = []
    for d in (REF_DIR, REEL_DIR):
        if d.exists():
            for p in sorted(d.iterdir()):
                if p.suffix.lower() in VIDEO_EXTS:
                    files.append(p)
    return files


def probe(path: Path) -> dict:
    out = subprocess.check_output(
        [
            "ffprobe", "-v", "error", "-print_format", "json",
            "-show_streams", "-show_format", str(path),
        ],
        text=True,
    )
    data = json.loads(out)
    v = next(s for s in data["streams"] if s["codec_type"] == "video")
    num, den = (int(x) for x in v["r_frame_rate"].split("/"))
    return {
        "duration": float(data["format"]["duration"]),
        "fps": num / den if den else 30,
        "width": int(v["width"]),
        "height": int(v["height"]),
    }


def detect_scenes(path: Path) -> list[float]:
    from scenedetect import detect, ContentDetector

    scenes = detect(str(path), ContentDetector(threshold=27.0))
    return [s[1].get_seconds() - s[0].get_seconds() for s in scenes]


def color_palette(path: Path, samples: int = 6) -> dict:
    import cv2
    import numpy as np

    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        return {"palette": [], "meanBrightness": None, "meanSaturation": None}

    frames: list[np.ndarray] = []
    for i in range(samples):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
        ok, f = cap.read()
        if ok:
            frames.append(cv2.resize(f, (160, 284)))
    cap.release()

    if not frames:
        return {"palette": [], "meanBrightness": None, "meanSaturation": None}

    stack = np.concatenate([f.reshape(-1, 3) for f in frames], axis=0).astype(np.float32)
    _, labels, centers = cv2.kmeans(
        stack, 4, None,
        (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_MAX_ITER, 10, 1.0),
        2, cv2.KMEANS_PP_CENTERS,
    )
    counts = np.bincount(labels.flatten(), minlength=len(centers))
    order = np.argsort(-counts)
    palette = [
        f"#{int(centers[k][2]):02x}{int(centers[k][1]):02x}{int(centers[k][0]):02x}"
        for k in order
    ]

    hsv = cv2.cvtColor(np.concatenate(frames, axis=0), cv2.COLOR_BGR2HSV)
    return {
        "palette": palette,
        "meanBrightness": round(float(hsv[:, :, 2].mean()) / 255, 3),
        "meanSaturation": round(float(hsv[:, :, 1].mean()) / 255, 3),
    }


def keywords_from_filenames(paths: list[Path]) -> list[str]:
    counter: dict[str, int] = {}
    for p in paths:
        for tok in re.split(r"[^a-z]+", p.stem.lower()):
            if len(tok) >= 4 and tok not in STOP and not tok.isdigit():
                counter[tok] = counter.get(tok, 0) + 1
    ranked = sorted(counter.items(), key=lambda kv: -kv[1])
    return [k for k, _ in ranked[:8]]


def main() -> None:
    files = list_videos()
    if not files:
        print(f"No videos in {REF_DIR} or {REEL_DIR}")
        sys.exit(1)

    per_reel: list[dict] = []
    all_shots: list[float] = []
    all_palette: list[str] = []
    brightness: list[float] = []
    saturation: list[float] = []

    for f in files:
        try:
            info = probe(f)
        except Exception as e:
            print(f"[skip] {f.name}: probe failed — {e}")
            continue
        try:
            shots = detect_scenes(f)
        except Exception as e:
            print(f"[skip] {f.name}: scenedetect failed — {e}")
            shots = []
        try:
            color = color_palette(f)
        except Exception as e:
            print(f"[skip] {f.name}: color failed — {e}")
            color = {"palette": [], "meanBrightness": None, "meanSaturation": None}

        all_shots.extend(shots)
        all_palette.extend(color["palette"])
        if color["meanBrightness"] is not None:
            brightness.append(color["meanBrightness"])
            saturation.append(color["meanSaturation"])

        per_reel.append(
            {
                "file": f.name,
                "duration": round(info["duration"], 2),
                "fps": round(info["fps"], 2),
                "resolution": f"{info['width']}x{info['height']}",
                "aspect": "vertical" if info["height"] > info["width"] else "horizontal",
                "shotCount": len(shots),
                "avgShotLengthSec": round(statistics.mean(shots), 3) if shots else None,
                "medianShotLengthSec": round(statistics.median(shots), 3) if shots else None,
                "color": color,
            }
        )
        print(
            f"[ok] {f.name[:60]:60s} {info['duration']:5.1f}s "
            f"{len(shots):3d} shots  avg={per_reel[-1]['avgShotLengthSec']}s"
        )

    keywords = keywords_from_filenames(files)
    palette_top = []
    seen = set()
    for hex_ in all_palette:
        if hex_ not in seen:
            palette_top.append(hex_)
            seen.add(hex_)
        if len(palette_top) == 6:
            break

    fingerprint = {
        "referenceCount": len(per_reel),
        "outputTarget": {"aspect": "9:16", "width": 1080, "height": 1920, "fps": 30},
        "aggregate": {
            "avgShotLengthSec": round(statistics.mean(all_shots), 3) if all_shots else None,
            "medianShotLengthSec": round(statistics.median(all_shots), 3) if all_shots else None,
            "shotsPerSecond": round(
                len(all_shots) / sum(r["duration"] for r in per_reel), 3
            ) if per_reel else None,
            "meanBrightness": round(statistics.mean(brightness), 3) if brightness else None,
            "meanSaturation": round(statistics.mean(saturation), 3) if saturation else None,
            "topPalette": palette_top,
        },
        "keywords": keywords,
        "perReel": per_reel,
        "notes": (
            "Pacing + color fingerprint. Edit `keywords` by hand to refine "
            "Pexels B-roll search. Feed sampled keyframes into Gemini/Claude "
            "vision for caption-style + hook-structure if you want richer signal."
        ),
    }

    OUT_PATH.write_text(json.dumps(fingerprint, indent=2) + "\n")
    print(f"\n→ {OUT_PATH}")
    print(f"  keywords: {keywords}")
    print(f"  avg shot: {fingerprint['aggregate']['avgShotLengthSec']}s")
    print(f"  palette : {palette_top[:3]}")


if __name__ == "__main__":
    main()

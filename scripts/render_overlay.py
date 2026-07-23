#!/usr/bin/env python3
"""Burn an assignment's labels onto its video, producing a watchable MP4.

The platform already shows a live HUD while annotating, and overlay.html can
replay a saved export over a video. This is the delivery version of the same
thing: one self-contained MP4 with the labels drawn in, so a reviewer or client
can watch the annotated result without the platform, a browser, or the JSON.

Only APPROVED work is rendered — the app queues these on publish.

Labels are drawn from an ASS subtitle track rather than a chain of ffmpeg
drawtext filters. A long session can carry hundreds of L1/L2 spans, and one
drawtext per span builds a filtergraph so large ffmpeg becomes unusable; an ASS
track holds them as ordinary timed events and costs the same regardless of
count. The frame counter is the one genuine per-frame value, so it stays a
drawtext with ffmpeg's %{n} expansion.

Source video: the ORIGINAL upload by default, so the deliverable is full quality
and not the downscaled scrub proxy. --source proxy burns onto the proxy instead
(smaller and faster). Frame indices are identical in both — the transcode is
constant frame rate and adds/drops no frames — so the labels line up either way.

Usage:
  python scripts/render_overlay.py --video clip.mp4 --export export.json --out out.mp4
  python scripts/render_overlay.py --video-key <r2key> --export-key <r2key> \
      --out out.mp4 --upload-key <r2key> --report-url ... --report-secret ...
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

# Rendered at this height; the ASS style below is sized for it. Scaling the video
# and the text together keeps the layout identical whatever the source is.
RENDER_HEIGHT = 720

QUALITY_FLAGS = [
    ("real_work", "real_work"),
    ("repetitive", "repetitive"),
    ("occluded", "occluded"),
    ("smudge", "smudge"),
    ("glare", "glare"),
    ("blur", "blur"),
]


def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def download_from_r2(blob_key: str, dest: str) -> None:
    import boto3
    from botocore.config import Config

    account = os.environ["R2_ACCOUNT_ID"]
    client = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )
    client.download_file(os.environ["R2_BUCKET"], blob_key, dest)


def upload_to_r2(path: str, key: str) -> None:
    import boto3
    from botocore.config import Config

    account = os.environ["R2_ACCOUNT_ID"]
    client = boto3.client(
        "s3",
        region_name="auto",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
        config=Config(signature_version="s3v4"),
    )
    client.upload_file(path, os.environ["R2_BUCKET"], key,
                       ExtraArgs={"ContentType": "video/mp4"})


def ass_time(seconds: float) -> str:
    """ASS timestamps are H:MM:SS.cc (centiseconds)."""
    if seconds < 0:
        seconds = 0.0
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = seconds % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def ass_escape(text: str) -> str:
    """Neutralise the ASS markup characters so a label can't break the track."""
    if not text:
        return ""
    out = text.replace("\\", "∖").replace("{", "(").replace("}", ")")
    return re.sub(r"[\r\n]+", " ", out).strip()


def build_ass(export: dict, fps: float, width: int, height: int) -> str:
    """Render the export's L1/L2/Q rows as a timed ASS subtitle track.

    Layout mirrors the in-app HUD so the burned video reads the same as the
    workspace: L1 on top, L2 under it, Q flags below that.
    """
    def t(frame: int) -> float:
        return frame / fps if fps > 0 else 0.0

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: L1,DejaVu Sans,26,&H00F5A25D,&H00000000,&H80000000,-1,0,1,2,1,7,16,16,44,1
Style: L2,DejaVu Sans,22,&H0086E5FD,&H00000000,&H80000000,0,0,1,2,1,7,16,16,80,1
Style: Q,DejaVu Sans,18,&H00FFFFFF,&H00000000,&H80000000,0,0,3,1,0,7,16,16,112,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    lines = [header]

    def event(style: str, start_f: int, end_f: int, text: str) -> None:
        if end_f <= start_f or not text:
            return
        lines.append(
            f"Dialogue: 0,{ass_time(t(start_f))},{ass_time(t(end_f))},{style},,0,0,0,,{text}"
        )

    for task in export.get("L1_tasks", []):
        meta = " · ".join(
            x for x in [task.get("difficulty"), task.get("venue_L2"),
                        task.get("venue_L3"), task.get("job")] if x
        )
        label = ass_escape(task.get("task_label") or "(unlabeled)")
        tail = f"  [{task.get('task_start_frame')}–{task.get('task_end_frame')}]"
        text = f"▶ {label}" + (f"   {ass_escape(meta)}" if meta else "") + tail
        event("L1", int(task.get("task_start_frame", 0)),
              int(task.get("task_end_frame", 0)), text)

    for sub in export.get("L2_subtasks", []):
        label = ass_escape(sub.get("action_label") or "(unlabeled)")
        hands = []
        if sub.get("object_left"):
            hands.append(f"L:{ass_escape(sub['object_left'])}")
        if sub.get("object_right"):
            hands.append(f"R:{ass_escape(sub['object_right'])}")
        text = f"• {label}" + (f"   {'  '.join(hands)}" if hands else "")
        event("L2", int(sub.get("action_start_frame", 0)),
              int(sub.get("action_end_frame", 0)), text)

    # Q rows are sampled every N frames; hold each until the next sample so the
    # flags stay on screen rather than blinking for a single frame.
    q_rows = sorted(export.get("Q_frame_quality", []),
                    key=lambda r: int(r.get("frame_index", 0)))
    total_frames = int(export.get("clip", {}).get("frameCount") or 0)
    for i, row in enumerate(q_rows):
        start = int(row.get("frame_index", 0))
        end = int(q_rows[i + 1]["frame_index"]) if i + 1 < len(q_rows) else (
            total_frames if total_frames > start else start + int(max(fps, 1))
        )
        on = [label for key, label in QUALITY_FLAGS if row.get(key)]
        text = f"Q@{start}  " + ("  ".join(on) if on else "—")
        event("Q", start, end, text)

    return "\n".join(lines) + "\n"


def probe_video(path: str) -> tuple[float, int, int]:
    """(fps, width, height) from ffmpeg's stream banner."""
    p = subprocess.run([ffmpeg_exe(), "-i", path], capture_output=True, text=True)
    fps_m = re.search(r"(\d+(?:\.\d+)?)\s+fps", p.stderr)
    dim_m = re.search(r"\s(\d{2,5})x(\d{2,5})[,\s]", p.stderr)
    fps = float(fps_m.group(1)) if fps_m else 0.0
    w = int(dim_m.group(1)) if dim_m else 0
    h = int(dim_m.group(2)) if dim_m else 0
    return fps, w, h


def report(url: str, secret: str | None, payload: dict) -> None:
    import urllib.request

    req = urllib.request.Request(url, data=json.dumps(payload).encode("utf-8"),
                                 method="POST")
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("x-transcode-secret", secret)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"# reported to {url}: HTTP {resp.status}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — a failed report shouldn't kill a good render
        print(f"# WARNING: could not report to {url}: {e}", file=sys.stderr)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", help="local source video")
    ap.add_argument("--video-key", help="R2 key of the source video")
    ap.add_argument("--export", help="local export JSON")
    ap.add_argument("--export-key", help="R2 key of the export JSON")
    ap.add_argument("--out", default="overlay.mp4")
    ap.add_argument("--upload-key", default=None, help="R2 key to upload the result to")
    ap.add_argument("--fps", type=float, default=None,
                    help="override fps (defaults to the export's, then the video's)")
    ap.add_argument("--height", type=int, default=RENDER_HEIGHT,
                    help="render height (0 = keep source height)")
    ap.add_argument("--crf", type=int, default=23, help="x264 CRF for the rendered MP4")
    ap.add_argument("--preset", default="veryfast", help="x264 preset")
    ap.add_argument("--report-url", default=None)
    ap.add_argument("--report-secret", default=None)
    args = ap.parse_args()
    try:
        run(args)
    except Exception as e:  # noqa: BLE001 — surface a stuck 'rendering' row as 'failed'
        if args.report_url:
            report(args.report_url, args.report_secret,
                   {"status": "failed", "error": str(e)})
        raise


def run(args) -> None:
    if not args.video and not args.video_key:
        raise SystemExit("Provide --video or --video-key.")
    if not args.export and not args.export_key:
        raise SystemExit("Provide --export or --export-key.")

    out_dir = os.path.dirname(os.path.abspath(args.out)) or None
    work = tempfile.mkdtemp(prefix="overlay_", dir=out_dir)

    video = args.video
    if not video:
        video = os.path.join(work, "source.mp4")
        print(f"# downloading video {args.video_key}…", file=sys.stderr)
        download_from_r2(args.video_key, video)

    if args.export:
        export = json.load(open(args.export, encoding="utf-8"))
    else:
        epath = os.path.join(work, "export.json")
        print(f"# downloading export {args.export_key}…", file=sys.stderr)
        download_from_r2(args.export_key, epath)
        export = json.load(open(epath, encoding="utf-8"))

    src_fps, src_w, src_h = probe_video(video)
    # The export's fps is authoritative: it is the rate the annotator's frame
    # indices were recorded against. Falling back to the container's rate only
    # when the export doesn't carry one.
    fps = args.fps or float(export.get("clip", {}).get("fps") or 0) or src_fps
    if not fps or fps <= 0:
        raise SystemExit("Could not determine fps from the export or the video.")

    # Compute the render size up front so the ASS PlayRes matches the output
    # exactly — otherwise libass rescales the text and the layout drifts.
    if args.height and args.height > 0 and src_h and src_h > args.height:
        out_h = args.height
        out_w = max(2, round(src_w * out_h / src_h / 2) * 2)
    else:
        out_h, out_w = src_h, src_w
    if not out_h or not out_w:
        raise SystemExit("Could not determine the source video dimensions.")

    ass_path = os.path.join(work, "labels.ass")
    with open(ass_path, "w", encoding="utf-8") as f:
        f.write(build_ass(export, fps, out_w, out_h))

    # ffmpeg filter paths are parsed, not passed literally: on Windows a
    # backslash and the drive colon both need escaping inside the filtergraph.
    ass_arg = ass_path.replace("\\", "/").replace(":", "\\:")
    chain = []
    if (out_w, out_h) != (src_w, src_h):
        chain.append(f"scale={out_w}:{out_h}")
    chain.append(f"ass='{ass_arg}'")
    # The frame counter is the one truly per-frame value, so it stays a drawtext.
    chain.append(
        "drawtext=text='frame %{n}':x=16:y=16:fontsize=24:fontcolor=white:"
        "borderw=2:bordercolor=black@0.8"
    )

    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error", "-stats",
           "-i", video, "-an", "-vf", ",".join(chain),
           "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", args.preset,
           "-crf", str(args.crf), "-movflags", "+faststart", args.out]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {p.stderr.strip()[-500:]}")

    counts = re.findall(r"frame=\s*(\d+)", p.stderr)
    frames = int(counts[-1]) if counts else 0

    if args.upload_key:
        print(f"# uploading overlay to R2: {args.upload_key}", file=sys.stderr)
        upload_to_r2(args.out, args.upload_key)

    metadata = {
        "status": "ready",
        "out": args.out,
        "uploaded_key": args.upload_key,
        "fps": round(fps, 4),
        "frame_count": frames,
        "width": out_w,
        "height": out_h,
        "l1_count": len(export.get("L1_tasks", [])),
        "l2_count": len(export.get("L2_subtasks", [])),
        "q_count": len(export.get("Q_frame_quality", [])),
    }
    shutil.rmtree(work, ignore_errors=True)
    print(json.dumps(metadata, indent=2))
    if args.report_url:
        report(args.report_url, args.report_secret, metadata)


if __name__ == "__main__":
    main()

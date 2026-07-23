#!/usr/bin/env python3
"""Transcode a recording session's MCAP segments into one playable MP4 proxy.

The annotatable stream is a foxglove.CompressedVideo (H.264) camera topic inside
each ~4-min MCAP segment. We concatenate the segments' H.264 access units in order
and re-encode them into a scrub-friendly MP4 proxy (dense keyframes, no B-frames,
height-capped), then report per-segment frame ranges + true fps so the platform can
fill Clip.frameCount and ClipSegment ranges. Pass --copy for a fast stream-copy
instead — faithful, but it inherits the recorder's GOP and scrubs badly.

Usage:
  # Local segments (proven path):
  python scripts/transcode_session.py --out proxy.mp4 \
      --mcap seg_004.mcap --mcap seg_005.mcap

  # From a session manifest.json (downloads blobs from R2 — needs R2_* env vars):
  python scripts/transcode_session.py --manifest manifest.json --out proxy.mp4 \
      [--upload-key tenants/<t>/proxies/<session>/ego.mp4]

Deps: mcap, mcap-protobuf-support, imageio-ffmpeg  (boto3 only for R2 modes).
Prints a JSON metadata blob on stdout (fps, frame_count, duration_sec, segments[]).
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

DEFAULT_TOPIC = "/top-left-camera/image-raw"  # left = monocular ego view


def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def extract_segment(mcap_path: str, topic: str, out_h264, limit: int | None):
    """Append a segment's H.264 access units to out_h264. Returns (frames, first_ns, last_ns, fmt)."""
    from mcap.reader import make_reader
    from mcap_protobuf.decoder import DecoderFactory

    frames = 0
    first_ns = last_ns = None
    fmt = None
    with open(mcap_path, "rb") as f:
        reader = make_reader(f, decoder_factories=[DecoderFactory()])
        for _schema, _channel, message, proto in reader.iter_decoded_messages(topics=[topic]):
            out_h264.write(bytes(proto.data))
            if fmt is None:
                fmt = getattr(proto, "format", "?")
            if first_ns is None:
                first_ns = message.log_time
            last_ns = message.log_time
            frames += 1
            if limit is not None and frames >= limit:
                break
    return frames, first_ns, last_ns, fmt


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


def resolve_segments(args) -> list[tuple[str, str]]:
    """Return ordered [(logical_path, local_mcap_path)]. Downloads from R2 if --manifest."""
    if args.mcap:
        return [(os.path.basename(p), p) for p in args.mcap]
    if args.manifest:
        manifest = json.load(open(args.manifest))
        assets = [a for a in manifest.get("assets", []) if a["logical_path"].lower().endswith(".mcap")]
        assets.sort(key=lambda a: a["logical_path"])
        out = []
        # Download next to --out so blobs land on the same (roomy) drive, not the
        # default temp dir which may be on a full disk.
        out_dir = os.path.dirname(os.path.abspath(args.out)) or None
        tmpdir = tempfile.mkdtemp(prefix="mcap_", dir=out_dir)
        for a in assets:
            dest = os.path.join(tmpdir, os.path.basename(a["logical_path"]))
            print(f"# downloading {a['logical_path']} from R2…", file=sys.stderr)
            download_from_r2(a["r2_object_key"], dest)
            out.append((a["logical_path"], dest))
        return out
    raise SystemExit("Provide --mcap (repeatable) or --manifest.")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mcap", action="append", help="local MCAP segment path (repeatable)")
    ap.add_argument("--manifest", help="session manifest.json (downloads blobs from R2)")
    # Flat-clip mode: a single already-playable video (an MP4 imported straight
    # from the bucket) rather than a session of MCAP segments. It still needs the
    # proxy treatment — an imported MP4 keeps whatever GOP and resolution the
    # recorder produced, which is what makes scrubbing freeze.
    ap.add_argument("--source-key", help="R2 key of a single video file to build a proxy from")
    ap.add_argument("--source-file", help="local path of a single video file to build a proxy from")
    ap.add_argument("--topic", default=DEFAULT_TOPIC)
    ap.add_argument("--out", default="proxy.mp4")
    ap.add_argument("--fps", type=float, default=None, help="override measured fps")
    ap.add_argument("--limit", type=int, default=None, help="cap frames per segment (testing)")
    ap.add_argument("--upload-key", default=None, help="R2 key to upload the proxy to")
    ap.add_argument("--reencode", action="store_true",
                    help="(kept for compatibility) force re-encode; re-encoding is now the default")
    ap.add_argument("--copy", action="store_true",
                    help="stream-copy the source H.264 instead of re-encoding. Fast to produce, "
                         "but the proxy inherits the source GOP/resolution — scrubbing will stall.")
    # 26 (not the usual 20): dense keyframes + no B-frames inflate bitrate a lot,
    # and this proxy is STREAMED from R2 while being scrubbed. CRF 20 measured
    # 5.5 Mbit/s on 1920x1200 rig footage — heavy enough that network stalls would
    # reintroduce the very freezing the dense GOP is meant to fix. 26 lands at
    # ~2.2 Mbit/s and stays clearly legible at 720p for object labelling.
    ap.add_argument("--crf", type=int, default=26, help="x264 CRF when re-encoding (lower=better)")
    ap.add_argument("--gop", type=int, default=None,
                    help="keyframe interval in frames when re-encoding (default ~0.5s; smaller=snappier seeking, bigger file)")
    ap.add_argument("--max-height", type=int, default=720,
                    help="downscale the proxy to at most this height (0 = keep source height). "
                         "Annotation only needs a legible view; full-res decode is what stalls the browser.")
    ap.add_argument("--preset", default="veryfast", help="x264 preset when re-encoding")
    ap.add_argument("--report-url", default=None,
                    help="POST the metadata to this URL when done (closes the transcode loop)")
    ap.add_argument("--report-secret", default=None,
                    help="value for the x-transcode-secret header on the report POST")
    args = ap.parse_args()
    try:
        run(args)
    except Exception as e:  # noqa: BLE001 — surface a stuck 'transcoding' clip as 'failed'
        if args.report_url:
            report_failed(args.report_url, args.report_secret, str(e))
        raise


def proxy_encode_args(args, gop: int) -> tuple[list[str], list[str]]:
    """The scrub-friendly proxy encode settings, shared by both input modes.

    Returns (video filter args, codec args). See the comment in run() for why
    dense keyframes and no B-frames matter here.
    """
    vcodec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", args.preset,
              "-crf", str(args.crf),
              "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0",
              # No B-frames: decode order == display order, so stepping backwards
              # a frame at a time doesn't force the decoder to reorder buffers.
              "-bf", "0",
              # Baseline-ish decode complexity + a level every browser accepts.
              "-profile:v", "high", "-level", "4.1",
              # Web player hint: lets the browser start rendering sooner.
              "-movflags", "+faststart"]
    vfilter: list[str] = []
    if args.max_height and args.max_height > 0:
        # Downscale only (never upscale) and keep even dimensions for yuv420p.
        vfilter = ["-vf", f"scale=-2:'min(ih,{args.max_height})'"]
    return vfilter, vcodec


def probe_fps(path: str) -> float | None:
    """Read the source frame rate out of ffmpeg's stream banner."""
    p = subprocess.run([ffmpeg_exe(), "-i", path], capture_output=True, text=True)
    m = re.search(r"(\d+(?:\.\d+)?)\s+fps", p.stderr)
    return float(m.group(1)) if m else None


def run_flat(args) -> None:
    """Build a proxy from ONE already-playable video file (not MCAP segments).

    This is the path for clips imported straight out of the bucket as MP4s. They
    play as-is, so nothing here is about playability — it's about seeking. An
    imported MP4 carries the recorder's GOP (multi-second on these rigs) at full
    resolution, so every scrub decodes from a distant keyframe. Re-encoding gives
    them the same dense-keyframe proxy a session gets.

    It also fixes the frame rate: a flat import guesses fps from the batch
    default, and a wrong fps silently shifts every exported frame index. Here we
    measure it from the file and report it back.
    """
    src = args.source_file
    tmpdir = None
    if not src:
        out_dir = os.path.dirname(os.path.abspath(args.out)) or None
        tmpdir = tempfile.mkdtemp(prefix="flat_", dir=out_dir)
        src = os.path.join(tmpdir, os.path.basename(args.source_key) or "source.mp4")
        print(f"# downloading {args.source_key} from R2…", file=sys.stderr)
        download_from_r2(args.source_key, src)

    fps = args.fps or probe_fps(src)
    if not fps or fps <= 0:
        raise SystemExit(f"Could not determine the frame rate of {args.source_key or src}.")

    gop = args.gop if args.gop and args.gop > 0 else max(1, round(fps / 2))
    vfilter, vcodec = proxy_encode_args(args, gop)
    # -r on both sides pins constant frame rate, so output frame i is source
    # frame i and the annotator's frame indices stay meaningful.
    cmd = [ffmpeg_exe(), "-y", "-loglevel", "error", "-stats",
           "-r", f"{fps:.6f}", "-i", src, "-an", *vfilter, *vcodec,
           "-r", f"{fps:.6f}", args.out]
    p = subprocess.run(cmd, capture_output=True, text=True)
    if p.returncode != 0:
        raise SystemExit(f"ffmpeg failed: {p.stderr.strip()[-400:]}")

    # Exact output frame count, straight from the encoder's own progress stats —
    # no second decode pass just to count.
    counts = re.findall(r"frame=\s*(\d+)", p.stderr)
    total_frames = int(counts[-1]) if counts else 0
    if total_frames <= 0:
        raise SystemExit("ffmpeg reported no encoded frames.")

    duration = total_frames / fps
    if args.upload_key:
        print(f"# uploading proxy to R2: {args.upload_key}", file=sys.stderr)
        upload_to_r2(args.out, args.upload_key)
    if tmpdir:
        shutil.rmtree(tmpdir, ignore_errors=True)

    metadata = {
        "out": args.out,
        "codec": "h264",
        "proxy_codec": "h264",
        "proxy_mode": "reencode",
        "fps": round(fps, 4),
        "frame_count": total_frames,
        "duration_sec": round(duration, 3),
        "uploaded_key": args.upload_key,
        # A flat clip has no MCAP segments, so there are no per-segment frame
        # ranges to report. The report route accepts this for non-session clips.
        "segments": [],
    }
    print(json.dumps(metadata, indent=2))
    if args.report_url:
        report_result(args.report_url, args.report_secret, metadata)


def run(args) -> None:
    if args.source_key or args.source_file:
        run_flat(args)
        return
    segments = resolve_segments(args)
    h264_path = args.out + ".h264"
    seg_meta = []
    total_frames = 0
    # fps is measured from INTRA-segment timing only (sum of per-segment spans),
    # so a wall-clock gap between two separately-recorded files can't distort it.
    seg_span_ns_total = 0
    seg_intervals_total = 0  # sum of (frames - 1) per segment
    fmt = None

    with open(h264_path, "wb") as h:
        for logical_path, path in segments:
            start_frame = total_frames
            frames, first_ns, last_ns, sfmt = extract_segment(path, args.topic, h, args.limit)
            fmt = fmt or sfmt
            if first_ns is not None and last_ns is not None and frames > 1:
                seg_span_ns_total += (last_ns - first_ns)
                seg_intervals_total += (frames - 1)
            total_frames += frames
            seg_meta.append({
                "logical_path": logical_path,
                "start_frame": start_frame,
                "end_frame": total_frames,
                "frames": frames,
            })

    # The concatenated access units are raw Annex-B; the demuxer must match the
    # source codec. HEVC (h265) plays unreliably in browsers and always needs a
    # re-encode.
    #
    # H.264 sources COULD stream-copy (fast, lossless) — and used to — but a copy
    # inherits the recorder's GOP structure, which on these rigs is multi-second
    # (sometimes one IDR per segment) at full sensor resolution with B-frames.
    # That is exactly the worst case for an annotation proxy: every seek makes the
    # browser decode from the previous keyframe, so scrubbing and frame-stepping
    # freeze. The proxy is scrubbed, not watched linearly, so we re-encode by
    # default and pay a one-time encode cost to make seeking cheap forever after.
    # --copy restores the old behaviour when you only want a fast, faithful proxy.
    demux = "hevc" if fmt in ("h265", "hevc") else "h264"
    if fmt not in ("h264", "h265", "hevc", None):
        print(f"# WARNING: unexpected codec {fmt!r}", file=sys.stderr)
    reencode = demux == "hevc" or args.reencode or not args.copy

    seg_span = seg_span_ns_total / 1e9
    fps = args.fps or (seg_intervals_total / seg_span if seg_span > 0 else 30.0)

    ff = ffmpeg_exe()
    vfilter: list[str] = []
    if reencode:
        # Re-encode to browser-safe H.264, constant frame rate (1 output frame per
        # input access unit) so frame index i still maps to source frame i. None of
        # the settings below add or drop frames, so seg_meta stays valid.
        #
        # DENSE keyframes (short GOP, no scene-cut keyframes) make frame-accurate
        # seeking/stepping snappy: a seek never decodes more than ~0.5s of video.
        gop = args.gop if args.gop and args.gop > 0 else max(1, round(fps / 2))
        vfilter, vcodec = proxy_encode_args(args, gop)
    else:
        vcodec = ["-c:v", "copy", "-movflags", "+faststart"]
    subprocess.run(
        [ff, "-y", "-loglevel", "error", "-f", demux, "-r", f"{fps:.6f}",
         "-i", h264_path, "-an", *vfilter, *vcodec, "-r", f"{fps:.6f}",
         args.out],
        check=True,
    )
    os.remove(h264_path)

    duration = total_frames / fps if fps else 0
    if args.upload_key:
        print(f"# uploading proxy to R2: {args.upload_key}", file=sys.stderr)
        upload_to_r2(args.out, args.upload_key)

    metadata = {
        "out": args.out,
        "codec": fmt,
        "proxy_codec": "h264" if reencode else fmt,
        "proxy_mode": "reencode" if reencode else "copy",
        "fps": round(fps, 4),
        "frame_count": total_frames,
        "duration_sec": round(duration, 3),
        "uploaded_key": args.upload_key,
        "segments": seg_meta,
    }
    print(json.dumps(metadata, indent=2))

    if args.report_url:
        report_result(args.report_url, args.report_secret, metadata)


def report_result(url: str, secret: str | None, metadata: dict) -> None:
    """POST the transcode metadata back to the platform to flip the clip to 'ready'."""
    import urllib.request

    body = json.dumps(metadata).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("x-transcode-secret", secret)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"# reported result to {url}: HTTP {resp.status}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001 — report failures shouldn't crash a good transcode
        print(f"# WARNING: failed to report result to {url}: {e}", file=sys.stderr)


def report_failed(url: str, secret: str | None, error: str) -> None:
    """Tell the platform the transcode failed so the clip leaves 'transcoding'."""
    import urllib.request

    body = json.dumps({"status": "failed", "error": error}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/json")
    if secret:
        req.add_header("x-transcode-secret", secret)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            print(f"# reported FAILURE to {url}: HTTP {resp.status}", file=sys.stderr)
    except Exception as e:  # noqa: BLE001
        print(f"# WARNING: failed to report failure to {url}: {e}", file=sys.stderr)


if __name__ == "__main__":
    main()

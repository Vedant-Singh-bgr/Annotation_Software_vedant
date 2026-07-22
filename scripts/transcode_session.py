#!/usr/bin/env python3
"""Transcode a recording session's MCAP segments into one playable MP4 proxy.

The annotatable stream is a foxglove.CompressedVideo (H.264) camera topic inside
each ~4-min MCAP segment. We concatenate the segments' H.264 access units in order
and STREAM-COPY them into an MP4 (no re-encode), then report per-segment frame
ranges + true fps so the platform can fill Clip.frameCount and ClipSegment ranges.

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
    ap.add_argument("--topic", default=DEFAULT_TOPIC)
    ap.add_argument("--out", default="proxy.mp4")
    ap.add_argument("--fps", type=float, default=None, help="override measured fps")
    ap.add_argument("--limit", type=int, default=None, help="cap frames per segment (testing)")
    ap.add_argument("--upload-key", default=None, help="R2 key to upload the proxy to")
    ap.add_argument("--reencode", action="store_true",
                    help="force re-encode to H.264 (auto-on for HEVC sources)")
    ap.add_argument("--crf", type=int, default=20, help="x264 CRF when re-encoding (lower=better)")
    ap.add_argument("--gop", type=int, default=None,
                    help="keyframe interval in frames when re-encoding (default ~0.5s; smaller=snappier seeking, bigger file)")
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


def run(args) -> None:
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
    # source codec. HEVC (h265) plays unreliably in browsers, so re-encode it to
    # H.264 for the proxy; H.264 sources stream-copy (fast, lossless).
    demux = "hevc" if fmt in ("h265", "hevc") else "h264"
    if fmt not in ("h264", "h265", "hevc", None):
        print(f"# WARNING: unexpected codec {fmt!r}", file=sys.stderr)
    reencode = args.reencode or demux == "hevc"

    seg_span = seg_span_ns_total / 1e9
    fps = args.fps or (seg_intervals_total / seg_span if seg_span > 0 else 30.0)

    ff = ffmpeg_exe()
    if reencode:
        # Re-encode to browser-safe H.264, constant frame rate (1 output frame per
        # input access unit) so frame index i still maps to source frame i.
        # DENSE keyframes (short GOP, no scene-cut keyframes) make frame-accurate
        # seeking/stepping snappy — the proxy is scrubbed, not watched linearly.
        gop = args.gop if args.gop and args.gop > 0 else max(1, round(fps / 2))
        vcodec = ["-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast",
                  "-crf", str(args.crf),
                  "-g", str(gop), "-keyint_min", str(gop), "-sc_threshold", "0"]
    else:
        vcodec = ["-c:v", "copy"]
    subprocess.run(
        [ff, "-y", "-loglevel", "error", "-f", demux, "-r", f"{fps:.6f}",
         "-i", h264_path, "-an", *vcodec, "-r", f"{fps:.6f}",
         "-movflags", "+faststart", args.out],
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

#!/usr/bin/env python3
"""Standalone transcode worker.

Claims session clips marked `queued` over HTTP and runs transcode_session.py for
each, one at a time. Runs as its OWN long-lived process — independent of the Next
server — so a multi-minute ffmpeg encode can't be killed by the web server being
recycled or redeployed.

The worker is DB-agnostic: it never connects to the database. It claims jobs from
POST {APP_URL}/api/worker/claim (shared-secret auth) and reports results back to
POST {APP_URL}/api/admin/clips/<id>/proxy. This is what lets the same worker run
against SQLite locally or managed Postgres in production without any change.

Flow:  admin clicks "Queue transcode"  ->  Clip.proxyStatus = 'queued'
       worker claims it (-> 'transcoding') -> transcode_session.py downloads blobs,
       builds the H.264 proxy, uploads it, and POSTs the result back to
       /api/admin/clips/<id>/proxy (which flips the clip to 'ready').

Required env (inherited from .env locally, or set in the host):
    APP_URL           base URL of the web app (e.g. https://your-app.up.railway.app)
    TRANSCODE_SECRET  shared secret for claim + report-back
    R2_*              so the child transcode can fetch blobs and upload the proxy
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
POLL_SECONDS = int(os.environ.get("WORKER_POLL_SECONDS", "3"))


def load_dotenv(path: str) -> None:
    """Populate os.environ from .env (existing env wins), so the worker needs no
    manual env setup — the child transcode inherits R2_*, TRANSCODE_SECRET,
    PYTHONPATH, TRANSCODE_TMPDIR, etc."""
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k, v = k.strip(), v.strip()
                if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
                    v = v[1:-1]
                v = v.replace("\\\\", "\\")  # de-escape doubled backslashes
                os.environ.setdefault(k, v)
    except FileNotFoundError:
        pass


load_dotenv(os.path.join(BASE, ".env"))
APP_URL = os.environ.get("APP_URL", "http://localhost:3000").rstrip("/")
# Hosts (e.g. Railway) often show the domain without a scheme; urllib needs one.
if not APP_URL.startswith(("http://", "https://")):
    APP_URL = "https://" + APP_URL
SECRET = os.environ.get("TRANSCODE_SECRET", "")


def claim_one():
    """Claim the next queued clip over HTTP. Returns a job dict or None."""
    req = urllib.request.Request(
        f"{APP_URL}/api/worker/claim",
        data=b"{}",
        method="POST",
        headers={"content-type": "application/json", "x-transcode-secret": SECRET},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")[:200]
        print(f"[worker] claim HTTP {e.code}: {detail}", file=sys.stderr, flush=True)
        return None
    except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
        print(f"[worker] claim unreachable: {e}", file=sys.stderr, flush=True)
        return None
    return body.get("job")


def report_failure(clip_id: str, message: str) -> None:
    """Tell the app a job failed so the clip leaves the 'transcoding' state."""
    payload = json.dumps({"status": "failed", "error": message}).encode("utf-8")
    req = urllib.request.Request(
        f"{APP_URL}/api/admin/clips/{clip_id}/proxy",
        data=payload,
        method="POST",
        headers={"content-type": "application/json", "x-transcode-secret": SECRET},
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:  # best-effort; the clip stays 'transcoding' if this fails
        print(f"[worker] could not report failure for {clip_id}: {e}", file=sys.stderr, flush=True)


def report_overlay_failure(assignment_id: str, message: str) -> None:
    """Tell the app an overlay render failed so it leaves the 'rendering' state."""
    payload = json.dumps({"status": "failed", "error": message}).encode("utf-8")
    req = urllib.request.Request(
        f"{APP_URL}/api/admin/assignments/{assignment_id}/overlay",
        data=payload,
        method="POST",
        headers={"content-type": "application/json", "x-transcode-secret": SECRET},
    )
    try:
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as e:  # best-effort
        print(f"[worker] could not report overlay failure for {assignment_id}: {e}",
              file=sys.stderr, flush=True)


def run_overlay_job(job: dict) -> None:
    """Burn an approved assignment's labels onto its video and upload the result."""
    assignment_id = job["assignmentId"]
    base_tmp = os.environ.get("TRANSCODE_TMPDIR") or None
    work = tempfile.mkdtemp(prefix="kosha-overlay-", dir=base_tmp)
    out = os.path.join(work, "overlay.mp4")
    report_url = f"{APP_URL}/api/admin/assignments/{assignment_id}/overlay"

    cmd = [
        sys.executable,
        os.path.join(BASE, "scripts", "render_overlay.py"),
        "--video-key", job["videoKey"],
        "--export-key", job["exportKey"],
        "--out", out,
        "--upload-key", job["overlayKey"],
        "--report-url", report_url,
        "--report-secret", SECRET,
    ]
    print(f"[worker] overlay {assignment_id} [{job.get('source')}] -> {job['overlayKey']} (rendering…)",
          flush=True)
    child_env = {**os.environ, "TEMP": work, "TMP": work, "TMPDIR": work}
    try:
        rc = subprocess.run(cmd, cwd=BASE, env=child_env).returncode
    except Exception as e:
        report_overlay_failure(assignment_id, f"worker crashed: {e}")
        shutil.rmtree(work, ignore_errors=True)
        raise
    print(f"[worker] overlay {assignment_id} finished rc={rc}", flush=True)
    if rc != 0:
        report_overlay_failure(assignment_id, f"render_overlay.py exited with code {rc}")
    shutil.rmtree(work, ignore_errors=True)


def run_job(job: dict) -> None:
    # Two job kinds share this worker: proxy transcodes and overlay renders.
    # Older app versions send no `kind`, so absence means transcode.
    if job.get("kind") == "overlay":
        run_overlay_job(job)
        return
    clip_id = job["clipId"]
    base_tmp = os.environ.get("TRANSCODE_TMPDIR") or None
    work = tempfile.mkdtemp(prefix="kosha-worker-", dir=base_tmp)
    out = os.path.join(work, "proxy.mp4")

    # "flat" jobs are single video objects imported straight from the bucket
    # (an MP4), not sessions of MCAP segments. They still get a proxy: the
    # import keeps the recorder's GOP and resolution, which is what makes
    # scrubbing stall. Older app versions don't send `mode`, so infer it.
    mode = job.get("mode") or ("session" if job.get("sessionId") else "flat")

    tenant = job["tenantId"]
    key = job.get("proxyKey") or (
        f"tenants/{tenant}/proxies/{job['sessionId']}/ego.mp4"
        if tenant
        else f"proxies/{job['sessionId']}/ego.mp4"
    )
    report_url = f"{APP_URL}/api/admin/clips/{clip_id}/proxy"
    script = os.path.join(BASE, "scripts", "transcode_session.py")

    if mode == "flat":
        source_key = job.get("sourceKey")
        if not source_key:
            report_failure(clip_id, "flat transcode job has no sourceKey")
            shutil.rmtree(work, ignore_errors=True)
            return
        source_args = ["--source-key", source_key]
    else:
        manifest = {
            "schema_version": 2,
            "session_id": job["sessionId"],
            "session_hash": job["sessionHash"],
            "tenant_id": job["tenantId"],
            "worker_id": job["workerId"],
            "data_type": job["dataType"],
            "assets": job["segments"],
        }
        mpath = os.path.join(work, "manifest.json")
        json.dump(manifest, open(mpath, "w"))
        source_args = ["--manifest", mpath]

    cmd = [
        sys.executable,
        script,
        *source_args,
        "--out", out,
        "--upload-key", key,
        "--report-url", report_url,
        "--report-secret", SECRET,
    ]
    print(f"[worker] clip {clip_id} [{mode}] -> {key} (transcoding…)", flush=True)
    # Keep the child's scratch (blob downloads, ffmpeg temp) inside the work dir.
    child_env = {**os.environ, "TEMP": work, "TMP": work, "TMPDIR": work}
    try:
        rc = subprocess.run(cmd, cwd=BASE, env=child_env).returncode
    except Exception as e:  # never leave a clip stuck in 'transcoding'
        report_failure(clip_id, f"worker crashed: {e}")
        shutil.rmtree(work, ignore_errors=True)
        raise
    print(f"[worker] clip {clip_id} finished rc={rc}", flush=True)
    # transcode_session.py reports success itself; if it exited non-zero without
    # reporting, flip the clip to failed so it doesn't hang in 'transcoding'.
    if rc != 0:
        report_failure(clip_id, f"transcode_session.py exited with code {rc}")
    shutil.rmtree(work, ignore_errors=True)


def main() -> None:
    if not SECRET:
        sys.exit("TRANSCODE_SECRET is required (claim + report-back are secret-authed).")
    print(f"[worker] polling {APP_URL}/api/worker/claim for queued transcodes…", flush=True)
    while True:
        job = claim_one()
        if job:
            run_job(job)
        else:
            time.sleep(POLL_SECONDS)


if __name__ == "__main__":
    main()

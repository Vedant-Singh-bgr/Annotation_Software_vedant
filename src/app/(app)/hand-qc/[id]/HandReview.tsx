"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// Unpack the compact viewer binary written by packViewer() in src/lib/npz.ts.
type Hands = {
  frameCount: number;
  handCount: number;
  jointCount: number;
  fps: number;
  edges: Uint16Array; // flat pairs
  confirmed: Uint8Array; // frameCount*handCount
  joints: Float32Array; // frameCount*handCount*jointCount*3
};
function unpackViewer(buf: ArrayBuffer): Hands {
  const dv = new DataView(buf);
  let o = 0;
  const frameCount = dv.getUint32(o, true); o += 4;
  const handCount = dv.getUint32(o, true); o += 4;
  const jointCount = dv.getUint32(o, true); o += 4;
  const edgeCount = dv.getUint32(o, true); o += 4;
  const fps = dv.getFloat32(o, true); o += 4;
  const edges = new Uint16Array(buf.slice(o, o + edgeCount * 2 * 2)); o += edgeCount * 2 * 2;
  const confirmed = new Uint8Array(buf.slice(o, o + frameCount * handCount)); o += frameCount * handCount;
  const joints = new Float32Array(buf.slice(o)); // copy → guaranteed 4-byte aligned
  return { frameCount, handCount, jointCount, fps, edges, confirmed, joints };
}

const HAND_COLORS = [0x22d3ee, 0xfb923c]; // right / left

type Meta = {
  title: string;
  fps: number;
  frameCount: number;
  handCount: number;
  confirmedPct: number;
  droppedFrames: number;
  reviewStatus: string;
  reviewNote: string;
};

export default function HandReview({ id }: { id: string }) {
  const router = useRouter();
  const mountRef = useRef<HTMLDivElement>(null);
  const dataRef = useRef<Hands | null>(null);
  const frameRef = useRef(0);
  const playingRef = useRef(false);

  const [meta, setMeta] = useState<Meta | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // ── load data + build the three.js scene (client-only) ──────────────────────
  useEffect(() => {
    let renderer: THREE.WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let raf = 0;
    let disposed = false;

    // per-hand three objects
    const jointObjs: THREE.Points[] = [];
    const boneObjs: THREE.LineSegments[] = [];

    (async () => {
      try {
        const info = await fetch(`/api/hand-files/${id}/viewer`).then((r) => r.json());
        if (!info || info.error) throw new Error(info?.error ?? "Failed to load");
        setMeta(info);
        setNote(info.reviewNote ?? "");
        const buf = await fetch(info.url).then((r) => r.arrayBuffer());
        if (disposed) return;
        const hands = unpackViewer(buf);
        dataRef.current = hands;

        const mount = mountRef.current!;
        const w = mount.clientWidth || 640;
        const h = mount.clientHeight || 420;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0b0f16);
        const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
        camera.position.set(0, 0, -0.5); // camera-frame looks down +z; sit behind
        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        renderer.setSize(w, h);
        mount.appendChild(renderer.domElement);
        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;

        for (let hnd = 0; hnd < hands.handCount; hnd++) {
          const jg = new THREE.BufferGeometry();
          jg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hands.jointCount * 3), 3));
          const pts = new THREE.Points(jg, new THREE.PointsMaterial({ color: HAND_COLORS[hnd % 2], size: 0.008 }));
          scene.add(pts);
          jointObjs.push(pts);

          const bg = new THREE.BufferGeometry();
          bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array((hands.edges.length / 2) * 2 * 3), 3));
          const lines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: HAND_COLORS[hnd % 2] }));
          scene.add(lines);
          boneObjs.push(lines);
        }

        // Convert camera/image coords (y down) to a natural up view.
        const setXYZ = (arr: Float32Array, i: number, x: number, y: number, z: number) => {
          arr[i] = x; arr[i + 1] = -y; arr[i + 2] = z;
        };

        let centred = false;
        const updateFrame = (f: number) => {
          const H = hands.handCount, J = hands.jointCount;
          const centroid = new THREE.Vector3();
          let nc = 0;
          for (let hnd = 0; hnd < H; hnd++) {
            const ok = hands.confirmed[f * H + hnd] === 1;
            jointObjs[hnd].visible = ok;
            boneObjs[hnd].visible = ok;
            if (!ok) continue;
            const base = ((f * H + hnd) * J) * 3;
            const jpos = jointObjs[hnd].geometry.getAttribute("position") as THREE.BufferAttribute;
            for (let j = 0; j < J; j++) {
              const x = hands.joints[base + j * 3], y = hands.joints[base + j * 3 + 1], z = hands.joints[base + j * 3 + 2];
              setXYZ(jpos.array as Float32Array, j * 3, x, y, z);
              centroid.x += x; centroid.y += -y; centroid.z += z; nc++;
            }
            jpos.needsUpdate = true;
            const bpos = boneObjs[hnd].geometry.getAttribute("position") as THREE.BufferAttribute;
            const ba = bpos.array as Float32Array;
            for (let e = 0; e < hands.edges.length / 2; e++) {
              const a = hands.edges[e * 2], b = hands.edges[e * 2 + 1];
              const ai = base + a * 3, bi = base + b * 3;
              setXYZ(ba, e * 6, hands.joints[ai], hands.joints[ai + 1], hands.joints[ai + 2]);
              setXYZ(ba, e * 6 + 3, hands.joints[bi], hands.joints[bi + 1], hands.joints[bi + 2]);
            }
            bpos.needsUpdate = true;
          }
          if (nc > 0 && !centred) {
            centroid.multiplyScalar(1 / nc);
            controls!.target.copy(centroid);
            camera.position.set(centroid.x, centroid.y, centroid.z - 0.45);
            controls!.update();
            centred = true;
          }
        };

        (updateFrame as unknown as { current?: typeof updateFrame }).current = updateFrame;
        // stash so playback/slider effects can call it
        (dataRef.current as unknown as { _update?: typeof updateFrame })._update = updateFrame;
        updateFrame(0);

        let last = performance.now();
        const loop = () => {
          raf = requestAnimationFrame(loop);
          const now = performance.now();
          if (playingRef.current && hands.frameCount > 1) {
            const adv = Math.floor(((now - last) / 1000) * hands.fps);
            if (adv > 0) {
              last = now;
              let nf = frameRef.current + adv;
              if (nf >= hands.frameCount) nf = 0;
              frameRef.current = nf;
              updateFrame(nf);
              setFrame(nf);
            }
          } else {
            last = now;
          }
          controls!.update();
          renderer!.render(scene, camera);
        };
        loop();

        const onResize = () => {
          if (!mountRef.current || !renderer) return;
          const ww = mountRef.current.clientWidth, hh = mountRef.current.clientHeight;
          camera.aspect = ww / hh; camera.updateProjectionMatrix();
          renderer.setSize(ww, hh);
        };
        window.addEventListener("resize", onResize);
        (dataRef.current as unknown as { _cleanup?: () => void })._cleanup = () =>
          window.removeEventListener("resize", onResize);
      } catch (e) {
        if (!disposed) setLoadErr((e as Error).message);
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      (dataRef.current as unknown as { _cleanup?: () => void })?._cleanup?.();
      controls?.dispose();
      renderer?.dispose();
      if (renderer?.domElement && mountRef.current?.contains(renderer.domElement))
        mountRef.current.removeChild(renderer.domElement);
    };
  }, [id]);

  function scrub(f: number) {
    const hands = dataRef.current;
    if (!hands) return;
    const nf = Math.max(0, Math.min(hands.frameCount - 1, f));
    frameRef.current = nf;
    setFrame(nf);
    (hands as unknown as { _update?: (n: number) => void })._update?.(nf);
  }
  function togglePlay() {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  }

  async function review(action: "approve" | "reject") {
    setBusy(true);
    setActionMsg(null);
    try {
      const res = await fetch(`/api/hand-files/${id}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reviewNote: note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setMeta((m) => (m ? { ...m, reviewStatus: data.handFile.reviewStatus } : m));
      setActionMsg(`Marked ${data.handFile.reviewStatus.toLowerCase()}`);
      router.refresh();
    } catch (e) {
      setActionMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <div>
        <div
          ref={mountRef}
          className="aspect-video w-full overflow-hidden rounded-lg border border-ink-900/10 bg-black"
        />
        {loadErr && <p className="mt-2 text-sm text-accent-red">{loadErr}</p>}
        {meta && (
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <button onClick={togglePlay} className="btn-ghost h-9 px-3">
              {playing ? "❚❚ Pause" : "▶ Play"}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, meta.frameCount - 1)}
              value={frame}
              onChange={(e) => scrub(Number(e.target.value))}
              className="flex-1 accent-accent-blue"
            />
            <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500">
              {frame} / {meta.frameCount - 1}
            </span>
          </div>
        )}
        <p className="mt-1 text-[11px] text-ink-400">
          Drag to orbit · scroll to zoom · cyan = right hand · orange = left · a hand
          disappears on unconfirmed frames.
        </p>
      </div>

      <div className="space-y-4">
        {meta && (
          <>
            <div className="card space-y-1.5 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-ink-500">Status</span>
                <span
                  className={
                    meta.reviewStatus === "APPROVED"
                      ? "text-accent-green"
                      : meta.reviewStatus === "REJECTED"
                        ? "text-accent-red"
                        : "text-ink-700"
                  }
                >
                  {meta.reviewStatus.toLowerCase()}
                </span>
              </div>
              <Row label="Frames" value={`${meta.frameCount} · ${(meta.frameCount / (meta.fps || 30)).toFixed(0)}s @ ${meta.fps}fps`} />
              <Row label="Hands" value={String(meta.handCount)} />
              <Row
                label="Tracked"
                value={`${meta.confirmedPct.toFixed(1)}%`}
                warn={meta.confirmedPct < 100}
              />
              <Row label="Dropped slots" value={String(meta.droppedFrames)} warn={meta.droppedFrames > 0} />
            </div>

            <div>
              <div className="label">Review note</div>
              <textarea
                className="input resize-y"
                rows={3}
                value={note}
                placeholder="Why approve / reject…"
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => review("approve")}
                disabled={busy}
                className="flex-1 rounded-lg border border-accent-green/40 bg-accent-green/5 py-2 text-sm text-accent-green transition-colors duration-150 hover:bg-accent-green/10 disabled:opacity-40"
              >
                Approve
              </button>
              <button
                onClick={() => review("reject")}
                disabled={busy}
                className="flex-1 rounded-lg border border-accent-red/40 bg-accent-red/5 py-2 text-sm text-accent-red transition-colors duration-150 hover:bg-accent-red/10 disabled:opacity-40"
              >
                Reject
              </button>
            </div>
            {actionMsg && <p className="text-xs text-ink-500">{actionMsg}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-ink-500">{label}</span>
      <span className={`font-mono text-xs tabular-nums ${warn ? "text-accent-yellow" : "text-ink-700"}`}>
        {value}
      </span>
    </div>
  );
}

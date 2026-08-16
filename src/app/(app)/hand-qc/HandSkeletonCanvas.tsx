"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

// The parsed skeleton data, produced either by unpacking the R2 viewer payload
// (HandReview) or by parsing a local .npz in the browser (LocalHandPreview).
export type HandsData = {
  frameCount: number;
  handCount: number;
  jointCount: number;
  fps: number;
  edges: ArrayLike<number>; // flat [a,b,a,b,...]
  confirmed: Uint8Array; // frameCount*handCount
  joints: Float32Array; // frameCount*handCount*jointCount*3 (NaN where unconfirmed)
};

const HAND_COLORS = [0x22d3ee, 0xfb923c]; // right / left

// Self-contained three.js skeleton viewer + transport. Renders whatever hands
// data it's given — no fetching, no persistence — so it's reused for both the
// imported-from-R2 flow and the load-from-PC preview.
export default function HandSkeletonCanvas({ hands }: { hands: HandsData | null }) {
  const mountRef = useRef<HTMLDivElement>(null);
  const updateRef = useRef<((f: number) => void) | null>(null);
  const frameRef = useRef(0);
  const playingRef = useRef(false);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    const mount = mountRef.current;
    if (!hands || !mount) return;

    frameRef.current = 0;
    setFrame(0);
    playingRef.current = false;
    setPlaying(false);

    const jointObjs: THREE.Points[] = [];
    const boneObjs: THREE.LineSegments[] = [];
    const edgeCount = hands.edges.length / 2;

    const w = mount.clientWidth || 640;
    const h = mount.clientHeight || 420;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f16);
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.01, 100);
    camera.position.set(0, 0, -0.5);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(w, h);
    mount.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    for (let hnd = 0; hnd < hands.handCount; hnd++) {
      const jg = new THREE.BufferGeometry();
      jg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(hands.jointCount * 3), 3));
      const pts = new THREE.Points(jg, new THREE.PointsMaterial({ color: HAND_COLORS[hnd % 2], size: 0.008 }));
      scene.add(pts);
      jointObjs.push(pts);

      const bg = new THREE.BufferGeometry();
      bg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(edgeCount * 2 * 3), 3));
      const lines = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: HAND_COLORS[hnd % 2] }));
      scene.add(lines);
      boneObjs.push(lines);
    }

    // Camera/image coords have y down; flip so up is up in the viewer.
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
        const base = (f * H + hnd) * J * 3;
        const jpos = jointObjs[hnd].geometry.getAttribute("position") as THREE.BufferAttribute;
        const ja = jpos.array as Float32Array;
        for (let j = 0; j < J; j++) {
          const x = hands.joints[base + j * 3], y = hands.joints[base + j * 3 + 1], z = hands.joints[base + j * 3 + 2];
          setXYZ(ja, j * 3, x, y, z);
          centroid.x += x; centroid.y += -y; centroid.z += z; nc++;
        }
        jpos.needsUpdate = true;
        const bpos = boneObjs[hnd].geometry.getAttribute("position") as THREE.BufferAttribute;
        const ba = bpos.array as Float32Array;
        for (let e = 0; e < edgeCount; e++) {
          const a = hands.edges[e * 2], b = hands.edges[e * 2 + 1];
          const ai = base + a * 3, bi = base + b * 3;
          setXYZ(ba, e * 6, hands.joints[ai], hands.joints[ai + 1], hands.joints[ai + 2]);
          setXYZ(ba, e * 6 + 3, hands.joints[bi], hands.joints[bi + 1], hands.joints[bi + 2]);
        }
        bpos.needsUpdate = true;
      }
      if (nc > 0 && !centred) {
        centroid.multiplyScalar(1 / nc);
        controls.target.copy(centroid);
        camera.position.set(centroid.x, centroid.y, centroid.z - 0.45);
        controls.update();
        centred = true;
      }
    };
    updateRef.current = updateFrame;
    updateFrame(0);

    let raf = 0;
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
      controls.update();
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      if (!mount) return;
      const ww = mount.clientWidth, hh = mount.clientHeight;
      camera.aspect = ww / hh; camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    };
    window.addEventListener("resize", onResize);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      updateRef.current = null;
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement && mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement);
    };
  }, [hands]);

  function scrub(f: number) {
    if (!hands) return;
    const nf = Math.max(0, Math.min(hands.frameCount - 1, f));
    frameRef.current = nf;
    setFrame(nf);
    updateRef.current?.(nf);
  }
  function togglePlay() {
    playingRef.current = !playingRef.current;
    setPlaying(playingRef.current);
  }

  return (
    <div>
      <div
        ref={mountRef}
        className="aspect-video w-full overflow-hidden rounded-lg border border-ink-900/10 bg-black"
      />
      {hands && (
        <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
          <button onClick={togglePlay} className="btn-ghost h-9 px-3">
            {playing ? "❚❚ Pause" : "▶ Play"}
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(0, hands.frameCount - 1)}
            value={frame}
            onChange={(e) => scrub(Number(e.target.value))}
            className="flex-1 accent-accent-blue"
          />
          <span className="shrink-0 font-mono text-xs tabular-nums text-ink-500">
            {frame} / {hands.frameCount - 1}
          </span>
        </div>
      )}
      <p className="mt-1 text-[11px] text-ink-400">
        Drag to orbit · scroll to zoom · cyan = right hand · orange = left · a hand
        disappears on unconfirmed frames.
      </p>
    </div>
  );
}

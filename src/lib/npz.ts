import { unzipSync } from "fflate";

// Parse a hand-tracking `.npz` (a ZIP of `.npy` arrays) into the minimum the
// skeleton viewer needs, and pack it into a compact little-endian binary the
// browser reads directly. Only the Phase-1 keys are read; the MANO params /
// camera intrinsics in the file are ignored for now.
//
// Viewer binary layout (all little-endian), see unpackViewer in the client:
//   u32 frameCount | u32 handCount | u32 jointCount | u32 edgeCount | f32 fps
//   u16 edges[edgeCount*2]
//   u8  confirmed[frameCount*handCount]
//   f32 joints[frameCount*handCount*jointCount*3]   (NaN where unconfirmed)

// Pinhole camera intrinsics + the resolution they were calibrated at. Present in
// the ground-truth files; used to project the metric 3D joints (camera frame)
// onto the video: u = fx·X/Z + cx, v = fy·Y/Z + cy, then scale by
// displaySize/img. Null when the file predates them (skeleton then renders 3D
// only, never on the video).
export type HandIntrinsics = {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  imgW: number;
  imgH: number;
};

export type ParsedHands = {
  frameCount: number;
  handCount: number;
  jointCount: number;
  fps: number;
  edges: number[]; // flat pairs, length = edgeCount*2
  confirmed: Uint8Array; // frameCount*handCount
  joints: Float32Array; // frameCount*handCount*jointCount*3
  confirmedPct: number;
  droppedFrames: number;
  intrinsics: HandIntrinsics | null;
};

type Npy = { descr: string; shape: number[]; body: Uint8Array };

function parseNpy(buf: Uint8Array): Npy {
  if (buf[0] !== 0x93 || String.fromCharCode(buf[1], buf[2], buf[3], buf[4], buf[5]) !== "NUMPY")
    throw new Error("not a .npy array");
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const major = buf[6];
  let headerLen: number;
  let headerStart: number;
  if (major === 1) {
    headerLen = dv.getUint16(8, true);
    headerStart = 10;
  } else {
    headerLen = dv.getUint32(8, true);
    headerStart = 12;
  }
  const header = new TextDecoder("latin1").decode(buf.subarray(headerStart, headerStart + headerLen));
  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const shapeStr = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1];
  if (!descr || shapeStr === undefined) throw new Error("bad .npy header");
  const shape = shapeStr
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
  // Copy the data region into a fresh, offset-0 buffer so typed-array views are
  // correctly aligned regardless of the header padding.
  const body = buf.slice(headerStart + headerLen);
  return { descr, shape, body };
}

function count(shape: number[]): number {
  return shape.reduce((n, d) => n * d, 1);
}

function asFloat32(n: Npy): Float32Array {
  if (n.descr === "<f4") return new Float32Array(n.body.buffer, n.body.byteOffset, count(n.shape));
  if (n.descr === "<f8") return Float32Array.from(new Float64Array(n.body.buffer, n.body.byteOffset, count(n.shape)));
  throw new Error(`expected float, got ${n.descr}`);
}
function asInt(n: Npy): number[] {
  const c = count(n.shape);
  if (n.descr === "<i4") return Array.from(new Int32Array(n.body.buffer, n.body.byteOffset, c));
  if (n.descr === "<i8") return Array.from(new BigInt64Array(n.body.buffer, n.body.byteOffset, c), Number);
  throw new Error(`expected int, got ${n.descr}`);
}
function asBool(n: Npy): Uint8Array {
  if (n.descr === "|b1") return new Uint8Array(n.body.buffer, n.body.byteOffset, count(n.shape));
  throw new Error(`expected bool, got ${n.descr}`);
}
function scalarF32(n: Npy): number {
  return asFloat32(n)[0];
}
// A scalar int/float, read leniently so fx/fy/cx/cy (f4) and img_w/img_h (i4)
// go through one path.
function scalarNum(n: Npy): number {
  if (n.descr === "<f4" || n.descr === "<f8") return asFloat32(n)[0];
  return asInt(n)[0];
}

/** Parse the .npz bytes into the viewer-relevant arrays + QC signals. */
export function parseHandNpz(npz: Uint8Array): ParsedHands {
  const files = unzipSync(npz);
  const get = (name: string): Npy => {
    const f = files[`${name}.npy`] ?? files[name];
    if (!f) throw new Error(`.npz is missing "${name}" — is this a hand-tracking file?`);
    return parseNpy(f);
  };
  const opt = (name: string): Npy | null => {
    const f = files[`${name}.npy`] ?? files[name];
    return f ? parseNpy(f) : null;
  };

  const k3 = get("k3d_cam_metric"); // (F, H, J, 3) f32
  const [frameCount, handCount, jointCount] = k3.shape;
  const joints = asFloat32(k3);

  const edges = asInt(get("hand_edges")); // (E,2) -> flat pairs
  const confirmed = asBool(get("confirmed")); // (F,H)
  const fps = scalarF32(get("fps"));

  // Intrinsics for the on-video overlay. All-or-nothing: if any is missing the
  // file simply has no projection and the skeleton stays 3D-only.
  const fx = opt("fx"),
    fy = opt("fy"),
    cx = opt("cx"),
    cy = opt("cy"),
    iw = opt("img_w"),
    ih = opt("img_h");
  const intrinsics =
    fx && fy && cx && cy && iw && ih
      ? {
          fx: scalarNum(fx),
          fy: scalarNum(fy),
          cx: scalarNum(cx),
          cy: scalarNum(cy),
          imgW: scalarNum(iw),
          imgH: scalarNum(ih),
        }
      : null;

  let confirmedCount = 0;
  for (let i = 0; i < confirmed.length; i++) if (confirmed[i]) confirmedCount++;
  const total = confirmed.length || 1;

  return {
    frameCount,
    handCount,
    jointCount,
    fps: fps > 0 ? fps : 30,
    edges,
    confirmed,
    joints,
    confirmedPct: (confirmedCount / total) * 100,
    droppedFrames: total - confirmedCount,
    intrinsics,
  };
}

/** Pack the parsed hands into the compact viewer binary (see layout above). */
export function packViewer(p: ParsedHands): Uint8Array {
  const edgeCount = p.edges.length / 2;
  const headerBytes = 20; // 4*u32 + f32
  const edgeBytes = edgeCount * 2 * 2; // u16
  const confBytes = p.confirmed.length; // u8
  const jointBytes = p.joints.length * 4; // f32
  const out = new Uint8Array(headerBytes + edgeBytes + confBytes + jointBytes);
  const dv = new DataView(out.buffer);
  let o = 0;
  dv.setUint32(o, p.frameCount, true); o += 4;
  dv.setUint32(o, p.handCount, true); o += 4;
  dv.setUint32(o, p.jointCount, true); o += 4;
  dv.setUint32(o, edgeCount, true); o += 4;
  dv.setFloat32(o, p.fps, true); o += 4;
  for (let i = 0; i < p.edges.length; i++) { dv.setUint16(o, p.edges[i], true); o += 2; }
  out.set(p.confirmed, o); o += confBytes;
  out.set(new Uint8Array(p.joints.buffer, p.joints.byteOffset, jointBytes), o);
  return out;
}

import type { HandFrame } from "@/shared/contracts/input";
import type { SnapSettings } from "../state/settings";
import modelWeights from "./snapModelWeights.json";

export type SnapState = "ready" | "loaded" | "cooldown";

export type SnapFeatures = Readonly<{
  thumbMiddle: number;
  thumbIndex: number;
  middleWrist: number;
  frameVector: Float32Array;
  wristXY: readonly [number, number];
  timestampSec: number;
}>;

const WINDOW_SECONDS = modelWeights.windowSeconds;
const NUM_STEPS = modelWeights.numSteps;
const FRAME_DIM = modelWeights.featureDimFrame;
const TEMPORAL_DIM = modelWeights.featureDimTemporal;
const THRESHOLD = modelWeights.threshold;

const IDX_D_4_12 = 60;
const IDX_D_4_8 = 61;
const IDX_D_4_16 = 62;
const IDX_D_4_11 = 64;
const IDX_D_12_2 = 67;
const IDX_D_12_1 = 68;
const IDX_D_12_0 = 69;
const IDX_D_4_0 = 73;
const IDX_ASYM_IDX_MID = 77;
const IDX_ASYM_THB_MID = 78;
const IDX_CURL_THUMB = 81;
const IDX_CURL_MIDDLE = 83;

const CORE_INDICES = [
  IDX_D_4_12,
  IDX_D_4_11,
  IDX_D_4_8,
  IDX_D_4_16,
  IDX_D_12_2,
  IDX_D_12_1,
  IDX_D_12_0,
  IDX_ASYM_IDX_MID,
  IDX_ASYM_THB_MID,
  IDX_CURL_MIDDLE,
  IDX_CURL_THUMB,
] as const;

type Vec3 = [number, number, number];

const norm3 = (v: Vec3): number => Math.hypot(v[0], v[1], v[2]);

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const cross3 = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

const angleCos = (a: Vec3, b: Vec3, c: Vec3): number => {
  const u = sub3(a, b);
  const v = sub3(c, b);
  const nu = norm3(u);
  const nv = norm3(v);
  if (nu < 1e-6 || nv < 1e-6) return 0;
  return Math.max(-1, Math.min(1, dot3(u, v) / (nu * nv)));
};

export const canonicalizeLandmarks = (
  pts: readonly Vec3[],
  isLeftHand: boolean,
): { canon: Vec3[]; palmScale: number } => {
  const wrist = pts[0] ?? [0, 0, 0];
  const centered: Vec3[] = pts.map((p) => sub3(p, wrist));

  const d05 = norm3(centered[5] ?? [0, 0, 0]);
  const d09 = norm3(centered[9] ?? [0, 0, 0]);
  const d017 = norm3(centered[17] ?? [0, 0, 0]);
  let palmScale = (d05 + d09 + d017) / 3;
  if (palmScale < 1e-5) palmScale = 1e-5;

  const scaled: Vec3[] = centered.map((p) => [p[0] / palmScale, p[1] / palmScale, p[2] / palmScale]);

  const s9 = scaled[9] ?? [0, -1, 0];
  const ny = norm3(s9);
  const ey: Vec3 = ny < 1e-5 ? [0, -1, 0] : [s9[0] / ny, s9[1] / ny, s9[2] / ny];

  const across = sub3(scaled[17] ?? [1, 0, 0], scaled[5] ?? [0, 0, 0]);
  const proj = dot3(across, ey);
  const rawEx: Vec3 = [across[0] - proj * ey[0], across[1] - proj * ey[1], across[2] - proj * ey[2]];
  const nx = norm3(rawEx);
  let ex: Vec3 = nx < 1e-5 ? [1, 0, 0] : [rawEx[0] / nx, rawEx[1] / nx, rawEx[2] / nx];
  if (isLeftHand) {
    ex = [-ex[0], -ex[1], -ex[2]];
  }

  let ez = cross3(ex, ey);
  const nz = norm3(ez);
  if (nz > 1e-5) {
    ez = [ez[0] / nz, ez[1] / nz, ez[2] / nz];
  }

  const canon: Vec3[] = scaled.map((p) => [dot3(p, ex), dot3(p, ey), dot3(p, ez)]);
  return { canon, palmScale };
};

export const extractFrameFeatures = (
  pts: readonly Vec3[],
  isLeftHand: boolean,
): { feat: Float32Array; palmScale: number } => {
  const { canon, palmScale } = canonicalizeLandmarks(pts, isLeftHand);
  const out = new Float32Array(FRAME_DIM);

  let ptr = 0;
  for (let i = 1; i < 21; i += 1) {
    const c = canon[i] ?? [0, 0, 0];
    out[ptr++] = c[0];
    out[ptr++] = c[1];
    out[ptr++] = c[2];
  }

  const dist = (i: number, j: number): number => norm3(sub3(canon[i] ?? [0, 0, 0], canon[j] ?? [0, 0, 0]));

  const d_4_12 = dist(4, 12);
  const d_4_8 = dist(4, 8);
  const d_4_16 = dist(4, 16);
  const d_4_20 = dist(4, 20);
  const d_4_11 = dist(4, 11);
  const d_4_10 = dist(4, 10);
  const d_4_7 = dist(4, 7);
  const d_12_2 = dist(12, 2);
  const d_12_1 = dist(12, 1);
  const d_12_0 = dist(12, 0);
  const d_12_5 = dist(12, 5);
  const d_12_9 = dist(12, 9);
  const d_16_2 = dist(16, 2);
  const d_4_0 = dist(4, 0);
  const d_8_0 = dist(8, 0);
  const d_16_0 = dist(16, 0);
  const d_20_0 = dist(20, 0);
  const asym_idx_mid = d_8_0 - d_12_0;
  const asym_thb_mid = d_4_0 - d_12_0;
  const asym_mid_rng = d_12_0 - d_16_0;
  const d_4_9 = dist(4, 9);

  const dists = [
    d_4_12,
    d_4_8,
    d_4_16,
    d_4_20,
    d_4_11,
    d_4_10,
    d_4_7,
    d_12_2,
    d_12_1,
    d_12_0,
    d_12_5,
    d_12_9,
    d_16_2,
    d_4_0,
    d_8_0,
    d_16_0,
    d_20_0,
    asym_idx_mid,
    asym_thb_mid,
    asym_mid_rng,
    d_4_9,
  ];
  for (const val of dists) out[ptr++] = val;

  out[ptr++] = angleCos(canon[1]!, canon[2]!, canon[4]!);
  out[ptr++] = angleCos(canon[5]!, canon[6]!, canon[8]!);
  out[ptr++] = angleCos(canon[9]!, canon[10]!, canon[12]!);
  out[ptr++] = angleCos(canon[13]!, canon[14]!, canon[16]!);
  out[ptr++] = angleCos(canon[17]!, canon[18]!, canon[20]!);

  return { feat: out, palmScale };
};

export const snapFeatures = (frame: HandFrame): SnapFeatures | null => {
  const points = frame.landmarks;
  if (points.length < 21) return null;
  const aspect = frame.aspect && frame.aspect > 0 ? frame.aspect : 1;
  const pts: Vec3[] = points.map((lm) => [lm.x * aspect, lm.y, lm.z * aspect]);
  const isLeft = frame.hand === "left";
  const { feat, palmScale } = extractFrameFeatures(pts, isLeft);
  if (palmScale < 1e-4) return null;

  const w0 = pts[0]!;
  return {
    thumbMiddle: feat[IDX_D_4_12] ?? 1,
    thumbIndex: feat[IDX_D_4_8] ?? 1,
    middleWrist: feat[IDX_D_12_0] ?? 1,
    frameVector: feat,
    wristXY: [w0[0] / palmScale, w0[1] / palmScale],
    timestampSec: frame.timestampMs / 1000,
  };
};

type BufferItem = Readonly<{
  t: number;
  feat: Float32Array;
  wrist: readonly [number, number];
}>;

const interp1D = (targetT: Float32Array, subT: readonly number[], values: readonly number[]): Float32Array => {
  const out = new Float32Array(targetT.length);
  const n = subT.length;
  for (let i = 0; i < targetT.length; i += 1) {
    const t = targetT[i]!;
    if (t <= subT[0]!) {
      out[i] = values[0]!;
      continue;
    }
    if (t >= subT[n - 1]!) {
      out[i] = values[n - 1]!;
      continue;
    }
    let k = 0;
    while (k < n - 2 && subT[k + 1]! < t) k += 1;
    const t0 = subT[k]!;
    const t1 = subT[k + 1]!;
    const alpha = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
    out[i] = values[k]! + alpha * (values[k + 1]! - values[k]!);
  }
  return out;
};

const resampleWindow = (
  items: readonly BufferItem[],
  tStart: number,
): { seqFeats: Float32Array[]; seqWrist: [number, number][] } | null => {
  const tEnd = tStart + WINDOW_SECONDS;
  const sub = items.filter((item) => item.t >= tStart - 1e-4 && item.t <= tEnd + 1e-4);
  if (sub.length < 4) return null;
  const span = sub[sub.length - 1]!.t - sub[0]!.t;
  if (span < WINDOW_SECONDS * 0.55) return null;
  for (let i = 1; i < sub.length; i += 1) {
    if (sub[i]!.t - sub[i - 1]!.t > 0.26) return null;
  }

  const subT = sub.map((x) => x.t);
  const targetT = new Float32Array(NUM_STEPS);
  for (let s = 0; s < NUM_STEPS; s += 1) {
    targetT[s] = subT[0]! + (s / (NUM_STEPS - 1)) * span;
  }

  const seqFeats: Float32Array[] = Array.from({ length: NUM_STEPS }, () => new Float32Array(FRAME_DIM));
  for (let d = 0; d < FRAME_DIM; d += 1) {
    const col = sub.map((x) => x.feat[d]!);
    const interp = interp1D(targetT, subT, col);
    for (let s = 0; s < NUM_STEPS; s += 1) {
      seqFeats[s]![d] = interp[s]!;
    }
  }

  const wX = interp1D(
    targetT,
    subT,
    sub.map((x) => x.wrist[0]),
  );
  const wY = interp1D(
    targetT,
    subT,
    sub.map((x) => x.wrist[1]),
  );
  const seqWrist: [number, number][] = [];
  for (let s = 0; s < NUM_STEPS; s += 1) {
    seqWrist.push([wX[s]!, wY[s]!]);
  }

  return { seqFeats, seqWrist };
};

const meanOf = (arr: readonly number[]): number => {
  if (arr.length === 0) return 0;
  let sum = 0;
  for (const x of arr) sum += x;
  return sum / arr.length;
};

const stdOf = (arr: readonly number[], mean?: number): number => {
  if (arr.length === 0) return 0;
  const m = mean ?? meanOf(arr);
  let sum = 0;
  for (const x of arr) {
    const d = x - m;
    sum += d * d;
  }
  return Math.sqrt(sum / arr.length);
};

export const extractWindowFeatures = (
  seqFeats: readonly Float32Array[],
  seqWrist: readonly [number, number][],
): Float32Array => {
  const L = seqFeats.length;
  const C = CORE_INDICES.length;
  const out = new Float32Array(TEMPORAL_DIM);
  let ptr = 0;

  // 1. Core trajectories flattened (12 * 11 = 132)
  for (let s = 0; s < L; s += 1) {
    const row = seqFeats[s]!;
    for (let c = 0; c < C; c += 1) {
      out[ptr++] = row[CORE_INDICES[c]!]!;
    }
  }

  // 2. First-order step velocities (11 * 4 = 44)
  const velMax = new Float32Array(C);
  const velMin = new Float32Array(C);
  const velStd = new Float32Array(C);
  const velArgmax = new Float32Array(C);

  for (let c = 0; c < C; c += 1) {
    const fIdx = CORE_INDICES[c]!;
    const diffs: number[] = [];
    let maxVal = -Infinity;
    let minVal = Infinity;
    let maxAbs = -1;
    let argMax = 0;
    for (let s = 0; s < L - 1; s += 1) {
      const dv = seqFeats[s + 1]![fIdx]! - seqFeats[s]![fIdx]!;
      diffs.push(dv);
      if (dv > maxVal) maxVal = dv;
      if (dv < minVal) minVal = dv;
      if (Math.abs(dv) > maxAbs) {
        maxAbs = Math.abs(dv);
        argMax = s;
      }
    }
    velMax[c] = maxVal;
    velMin[c] = minVal;
    velStd[c] = stdOf(diffs);
    velArgmax[c] = argMax / Math.max(1, L - 2);
  }
  for (let c = 0; c < C; c += 1) out[ptr++] = velMax[c]!;
  for (let c = 0; c < C; c += 1) out[ptr++] = velMin[c]!;
  for (let c = 0; c < C; c += 1) out[ptr++] = velStd[c]!;
  for (let c = 0; c < C; c += 1) out[ptr++] = velArgmax[c]!;

  // 3. Causal biomechanical transition features (30 dims)
  const col = (idx: number): number[] => seqFeats.map((r) => r[idx]!);
  const d412 = col(IDX_D_4_12);
  const d411 = col(IDX_D_4_11);
  const d416 = col(IDX_D_4_16);
  const d48 = col(IDX_D_4_8);
  const d12_2 = col(IDX_D_12_2);
  const d12_1 = col(IDX_D_12_1);
  const d12_0 = col(IDX_D_12_0);
  const d4_0 = col(IDX_D_4_0);
  const asymIdx = col(IDX_ASYM_IDX_MID);
  const asymThb = col(IDX_ASYM_THB_MID);
  const curlM = col(IDX_CURL_MIDDLE);

  let pinchMinIdx = 0;
  let pinchMinVal = Infinity;
  for (let s = 0; s < L - 2; s += 1) {
    const p = Math.min(d412[s]!, d411[s]!, d416[s]! * 1.05);
    if (p < pinchMinVal) {
      pinchMinVal = p;
      pinchMinIdx = s;
    }
  }

  const postD412 = d412.slice(pinchMinIdx + 1);
  const postD12_2 = d12_2.slice(pinchMinIdx + 1);
  const postD12_1 = d12_1.slice(pinchMinIdx + 1);
  const postD12_0 = d12_0.slice(pinchMinIdx + 1);
  const postAsymIdx = asymIdx.slice(pinchMinIdx + 1);
  const postAsymThb = asymThb.slice(pinchMinIdx + 1);
  const postD4_0 = d4_0.slice(pinchMinIdx + 1);

  const postD412Max = Math.max(...postD412);
  const postD12_2Min = Math.min(...postD12_2);
  const postD12_0Min = Math.min(...postD12_0);
  const preD12_2AtPinch = d12_2[pinchMinIdx]!;
  const preD12_0AtPinch = d12_0[pinchMinIdx]!;
  const postAsymIdxMax = Math.max(...postAsymIdx);
  const postAsymThbMax = Math.max(...postAsymThb);
  const jumpAsymThb = postAsymThbMax - asymThb[pinchMinIdx]!;

  let maxOpp1 = 0;
  for (let s = 0; s < L - 1; s += 1) {
    const dd412 = d412[s + 1]! - d412[s]!;
    const dd12_0 = d12_0[s + 1]! - d12_0[s]!;
    const opp = Math.max(0, dd412) * Math.max(0, -dd12_0);
    if (opp > maxOpp1) maxOpp1 = opp;
  }

  let maxOpp2 = 0;
  let maxStrike2 = 0;
  let maxDasymThb2 = -Infinity;
  let minDd12_0_2 = Infinity;
  let minDd12_2_2 = Infinity;
  for (let s = 0; s < L - 2; s += 1) {
    const dd412_2 = d412[s + 2]! - d412[s]!;
    const dd12_0_2 = d12_0[s + 2]! - d12_0[s]!;
    const dd12_2_2 = d12_2[s + 2]! - d12_2[s]!;
    const dasym2 = asymThb[s + 2]! - asymThb[s]!;
    const opp2 = Math.max(0, dd412_2) * Math.max(0, -dd12_0_2);
    const strike2 = Math.max(0, dasym2) * Math.max(0, -dd12_2_2);
    if (opp2 > maxOpp2) maxOpp2 = opp2;
    if (strike2 > maxStrike2) maxStrike2 = strike2;
    if (dasym2 > maxDasymThb2) maxDasymThb2 = dasym2;
    if (dd12_0_2 < minDd12_0_2) minDd12_0_2 = dd12_0_2;
    if (dd12_2_2 < minDd12_2_2) minDd12_2_2 = dd12_2_2;
  }

  let maxPostDiffD412 = -Infinity;
  let minPostDiffD12_2 = Infinity;
  for (let s = pinchMinIdx; s < L - 1; s += 1) {
    const df412 = d412[s + 1]! - d412[s]!;
    const df12_2 = d12_2[s + 1]! - d12_2[s]!;
    if (df412 > maxPostDiffD412) maxPostDiffD412 = df412;
    if (df12_2 < minPostDiffD12_2) minPostDiffD12_2 = df12_2;
  }

  const spdThumb: number[] = [];
  const spdIndex: number[] = [];
  const spdMiddle: number[] = [];
  for (let s = 0; s < L - 1; s += 1) {
    const r0 = seqFeats[s]!;
    const r1 = seqFeats[s + 1]!;
    spdThumb.push(Math.hypot(r1[9]! - r0[9]!, r1[10]! - r0[10]!, r1[11]! - r0[11]!));
    spdIndex.push(Math.hypot(r1[21]! - r0[21]!, r1[22]! - r0[22]!, r1[23]! - r0[23]!));
    spdMiddle.push(Math.hypot(r1[33]! - r0[33]!, r1[34]! - r0[34]!, r1[35]! - r0[35]!));
  }
  const maxSpdMiddle = Math.max(...spdMiddle);
  const maxSpdThumb = Math.max(...spdThumb);
  const relSpdMidVsIdx = maxSpdMiddle / (meanOf(spdIndex) + 0.05);

  const half = L >> 1;
  const causal = [
    pinchMinVal,
    pinchMinIdx / L,
    postD412Max - pinchMinVal,
    preD12_2AtPinch - postD12_2Min,
    preD12_0AtPinch - postD12_0Min,
    postD12_2Min,
    Math.min(...postD12_1),
    postD12_0Min,
    postAsymIdxMax,
    postAsymIdxMax - asymIdx[pinchMinIdx]!,
    postAsymThbMax,
    jumpAsymThb,
    maxOpp1,
    maxOpp2,
    maxStrike2,
    maxDasymThb2,
    minDd12_0_2,
    minDd12_2_2,
    maxPostDiffD412,
    minPostDiffD12_2,
    maxSpdMiddle,
    maxSpdThumb,
    relSpdMidVsIdx,
    Math.min(...d416),
    Math.min(...d48),
    Math.max(...postD4_0),
    meanOf(d412.slice(half)) - meanOf(d412.slice(0, half)),
    meanOf(d12_2.slice(half)) - meanOf(d12_2.slice(0, half)),
    meanOf(asymThb.slice(half)) - meanOf(asymThb.slice(0, half)),
    meanOf(curlM.slice(half)) - meanOf(curlM.slice(0, half)),
  ];
  for (const val of causal) out[ptr++] = val;

  // 4. Global summary stats across all 86 frame features (86 * 5 = 430)
  const fMean = new Float32Array(FRAME_DIM);
  const fStd = new Float32Array(FRAME_DIM);
  const fMin = new Float32Array(FRAME_DIM);
  const fMax = new Float32Array(FRAME_DIM);
  const fDelta = new Float32Array(FRAME_DIM);

  for (let d = 0; d < FRAME_DIM; d += 1) {
    let sum = 0;
    let sumFirst = 0;
    let sumSecond = 0;
    let mn = Infinity;
    let mx = -Infinity;
    for (let s = 0; s < L; s += 1) {
      const v = seqFeats[s]![d]!;
      sum += v;
      if (s < half) sumFirst += v;
      else sumSecond += v;
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const mean = sum / L;
    let varSum = 0;
    for (let s = 0; s < L; s += 1) {
      const dv = seqFeats[s]![d]! - mean;
      varSum += dv * dv;
    }
    fMean[d] = mean;
    fStd[d] = Math.sqrt(varSum / L);
    fMin[d] = mn;
    fMax[d] = mx;
    fDelta[d] = sumSecond / (L - half) - sumFirst / half;
  }
  for (let d = 0; d < FRAME_DIM; d += 1) out[ptr++] = fMean[d]!;
  for (let d = 0; d < FRAME_DIM; d += 1) out[ptr++] = fStd[d]!;
  for (let d = 0; d < FRAME_DIM; d += 1) out[ptr++] = fMin[d]!;
  for (let d = 0; d < FRAME_DIM; d += 1) out[ptr++] = fMax[d]!;
  for (let d = 0; d < FRAME_DIM; d += 1) out[ptr++] = fDelta[d]!;

  // 5. Wrist motion stability features (3 dims)
  const wVel: number[] = [];
  for (let s = 0; s < L - 1; s += 1) {
    const w0 = seqWrist[s]!;
    const w1 = seqWrist[s + 1]!;
    wVel.push(Math.hypot(w1[0] - w0[0], w1[1] - w0[1]));
  }
  out[ptr++] = meanOf(wVel);
  out[ptr++] = Math.max(...wVel);
  out[ptr++] = Math.hypot(seqWrist[L - 1]![0] - seqWrist[0]![0], seqWrist[L - 1]![1] - seqWrist[0]![1]);

  return out;
};

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, x))));

const predictHgbProba = (vec: Float32Array): number => {
  let raw = modelWeights.hgbBaseline;
  const trees = modelWeights.hgbTrees;
  for (let t = 0; t < trees.length; t += 1) {
    const nodes = trees[t]!;
    let idx = 0;
    while (idx < nodes.length) {
      const node = nodes[idx]!;
      if (node[0] === 1) {
        raw += node[1]!;
        break;
      }
      const fIdx = node[1]!;
      const thresh = node[2]!;
      idx = (vec[fIdx] ?? 0) <= thresh ? (node[3] as number) : (node[4] as number);
    }
  }
  return sigmoid(raw);
};

const predictMlpProba = (vec: Float32Array): number => {
  const mean = modelWeights.scalerMean;
  const scale = modelWeights.scalerScale;
  let current = new Float32Array(TEMPORAL_DIM);
  for (let i = 0; i < TEMPORAL_DIM; i += 1) {
    current[i] = ((vec[i] ?? 0) - (mean[i] ?? 0)) / (scale[i] || 1);
  }

  const coefs = modelWeights.mlpCoefs;
  const intercepts = modelWeights.mlpIntercepts;

  for (let layerIdx = 0; layerIdx < coefs.length; layerIdx += 1) {
    const weights = coefs[layerIdx]!;
    const bias = intercepts[layerIdx]!;
    const outDim = bias.length;
    const next = new Float32Array(outDim);
    const isLast = layerIdx === coefs.length - 1;

    for (let j = 0; j < outDim; j += 1) {
      let sum = bias[j] ?? 0;
      for (let i = 0; i < current.length; i += 1) {
        sum += current[i]! * (weights[i]?.[j] ?? 0);
      }
      next[j] = isLast ? sum : Math.max(0, sum);
    }
    current = next;
  }

  return sigmoid(current[0] ?? 0);
};

export const predictSnapProbability = (vec: Float32Array): number => {
  const pHgb = predictHgbProba(vec);
  const pMlp = predictMlpProba(vec);
  const w0 = modelWeights.weights[0] ?? 2.2;
  const w1 = modelWeights.weights[1] ?? 1.5;
  return (w0 * pHgb + w1 * pMlp) / (w0 + w1);
};

type SnapTick = Readonly<{
  nowMs: number;
  features: SnapFeatures;
  busy: boolean;
}>;

const AFTER_PINCH_MS = 450;

export class SnapGestureRecognizer {
  private state: SnapState = "ready";
  private stateSinceMs = 0;
  private quietUntilMs = 0;
  private lastProb = 0;
  private readonly buffer: BufferItem[] = [];

  constructor(private settings: SnapSettings) {}

  setSettings(settings: SnapSettings): void {
    this.settings = settings;
  }

  get currentState(): SnapState {
    return this.state;
  }

  get probability(): number {
    return this.lastProb;
  }

  progress(): number {
    return this.state === "loaded" ? Math.min(0.95, Math.max(0.35, this.lastProb)) : 0;
  }

  update(tick: SnapTick): boolean {
    const { nowMs, features } = tick;
    if (tick.busy) {
      this.quietUntilMs = nowMs + AFTER_PINCH_MS;
      this.buffer.length = 0;
      this.toReady(nowMs);
      return false;
    }

    if (this.state === "cooldown") {
      if (nowMs - this.stateSinceMs >= this.settings.cooldownMs) this.toReady(nowMs);
      return false;
    }

    const tSec = features.timestampSec;
    while (this.buffer.length > 0 && tSec - this.buffer[0]!.t > WINDOW_SECONDS + 0.2) {
      this.buffer.shift();
    }

    this.buffer.push({
      t: tSec,
      feat: features.frameVector,
      wrist: features.wristXY,
    });

    if (nowMs < this.quietUntilMs || this.buffer.length < 4) return false;

    const firstT = this.buffer[0]!.t;
    const lastT = this.buffer[this.buffer.length - 1]!.t;
    if (lastT - firstT < WINDOW_SECONDS * 0.55) return false;

    const tStart = Math.max(firstT, lastT - WINDOW_SECONDS);
    const resampled = resampleWindow(this.buffer, tStart);
    if (!resampled) return false;

    const windowVec = extractWindowFeatures(resampled.seqFeats, resampled.seqWrist);
    const prob = predictSnapProbability(windowVec);
    this.lastProb = prob;

    if (prob >= THRESHOLD) {
      this.state = "cooldown";
      this.stateSinceMs = nowMs;
      this.buffer.length = 0;
      return true;
    }

    if (prob >= 0.42 || features.thumbMiddle < 0.48) {
      this.state = "loaded";
    } else {
      this.state = "ready";
    }
    return false;
  }

  reset(): void {
    this.state = "ready";
    this.lastProb = 0;
    this.buffer.length = 0;
  }

  private toReady(nowMs: number): void {
    this.state = "ready";
    this.stateSinceMs = nowMs;
    this.lastProb = 0;
  }
}

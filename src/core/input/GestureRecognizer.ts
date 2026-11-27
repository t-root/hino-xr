import type { HandFrame, Landmark } from "@/shared/contracts/input";
import { distance2 } from "@/shared/math/num";

const LANDMARK = {
  wrist: 0,
  thumbMcp: 2,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleMcp: 9,
  middleTip: 12,
  pinkyMcp: 17,
} as const;

type HandSignals = Readonly<{
  pinchRatio: number;
  thumbMiddleRatio: number;
  middleCurlRatio: number;
  indexTip: Landmark;
  thumbTip: Landmark;
  middleTip: Landmark;
  palmCenter: Landmark;
  pinchPoint: Landmark;
  handSize: number;
  snapPress: boolean;
}>;

const at = (landmarks: readonly Landmark[], index: number): Landmark =>
  landmarks[index] ?? { x: 0, y: 0, z: 0 };

const span = (a: Landmark, b: Landmark): number => distance2(a.x, a.y, b.x, b.y);

export const extractSignals = (hand: HandFrame): HandSignals => {
  const { landmarks } = hand;
  const wrist = at(landmarks, LANDMARK.wrist);
  const middleMcp = at(landmarks, LANDMARK.middleMcp);
  const indexMcp = at(landmarks, LANDMARK.indexMcp);
  const thumbTip = at(landmarks, LANDMARK.thumbTip);
  const indexTip = at(landmarks, LANDMARK.indexTip);
  const middleTip = at(landmarks, LANDMARK.middleTip);
  const thumbMcp = at(landmarks, LANDMARK.thumbMcp);
  const pinkyMcp = at(landmarks, LANDMARK.pinkyMcp);

  const handSize = Math.max(span(wrist, middleMcp), 1e-4);

  const pinchScale = Math.max(
    span(thumbMcp, indexMcp),
    span(indexMcp, pinkyMcp) * 0.5,
    span(wrist, middleMcp) * 0.45,
    1e-4,
  );
  const palmCenter = {
    x: (wrist.x + indexMcp.x + middleMcp.x) / 3,
    y: (wrist.y + indexMcp.y + middleMcp.y) / 3,
    z: (wrist.z + indexMcp.z + middleMcp.z) / 3,
  };
  const pinchPoint = {
    x: (thumbTip.x + indexTip.x) / 2,
    y: (thumbTip.y + indexTip.y) / 2,
    z: (thumbTip.z + indexTip.z) / 2,
  };

  const pinchGap = span(thumbTip, indexTip);
  const snapGap = span(thumbTip, middleTip);

  return {
    pinchRatio: pinchGap / pinchScale,
    thumbMiddleRatio: snapGap / handSize,
    middleCurlRatio: span(middleTip, palmCenter) / handSize,
    indexTip,
    thumbTip,
    middleTip,
    palmCenter,
    pinchPoint,
    handSize,
    snapPress: snapGap * 1.6 < pinchGap,
  };
};

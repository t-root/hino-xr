import type { HandFrame, Landmark } from "@/shared/contracts/input";
import { distance2 } from "@/shared/math/num";

/** MediaPipe hand landmark indices used by the recognizer. */
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
  /**
   * How far apart the thumb and index tips look, over the size of the hand.
   *
   * Measured in the image, in two dimensions, and against whichever span of the
   * hand still faces the camera — so it means the same thing whichever way the
   * hand is turned, and what the other three fingers are doing never enters
   * into it. Touching is touching.
   */
  pinchRatio: number;
  /** Thumb-middle distance divided by hand size, used by snap detection. */
  thumbMiddleRatio: number;
  /**
   * Middle fingertip to palm centre, over hand size.
   *
   * Large with the finger extended, small once it has folded in. This is what
   * separates a snap from any other way of parting thumb and middle finger:
   * a snap ends with that finger against the palm, having been thrown there.
   */
  middleCurlRatio: number;
  indexTip: Landmark;
  thumbTip: Landmark;
  middleTip: Landmark;
  palmCenter: Landmark;
  /**
   * Midpoint of the thumb and index tips — where a pinch actually happens, and
   * therefore where the cursor sits. Aiming from the index tip alone walked off
   * the target as the thumb arrived to meet it.
   */
  pinchPoint: Landmark;
  /** Wrist-to-middle-MCP distance in normalised image units. */
  handSize: number;
  /**
   * True when thumb and middle are clearly the pair that is touching.
   *
   * A pinch puts the index next to the middle, so the two gaps are close. The
   * snap only wins when the middle is well closer — otherwise a pinch with the
   * other fingers curled in is eaten as a snap press, and then never clicks.
   */
  snapPress: boolean;
}>;

const at = (landmarks: readonly Landmark[], index: number): Landmark =>
  landmarks[index] ?? { x: 0, y: 0, z: 0 };

/**
 * Distance as the camera sees it, ignoring `z`.
 *
 * The depth a hand tracker reports is a guess, and a coarse one: two fingertips
 * that are visibly touching are routinely given depths a third of a hand apart.
 * Measuring in three dimensions therefore means a pinch that fails whenever the
 * hand is not square to the camera — which is most of the time, and is exactly
 * the case the wearer of a headset is in. What the wearer can see is the truth
 * the gesture is judged against.
 */
const span = (a: Landmark, b: Landmark): number => distance2(a.x, a.y, b.x, b.y);

/**
 * Converts raw landmarks into scale-invariant signals. Every threshold in the
 * system is expressed as a ratio of hand size, never in pixels, so the same
 * settings work at different camera distances and resolutions.
 */
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

  // The pinch is two fingertips on a hinge the width of the thumb-to-index
  // knuckles. Measuring against the whole length of the palm made a 2 cm click
  // look like 0.17 — still "closed" — so letting go never let go. The knuckle
  // span is what a pinch opens against. The other spans are only there for when
  // that hinge turns edge-on and shrinks.
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
    // Same 2D rule as the pinch: a tracker z that says two touching tips are
    // a third of a hand apart would make a snap press look like it never
    // happened. Curl is judged the same way — the finger looks on the palm
    // or it does not.
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

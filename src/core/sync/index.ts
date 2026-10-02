/**
 * Everything that keeps the two eyes identical, in one place (rules.md).
 *
 * The interface — Core's panels and every plugin's screen — is drawn once per
 * eye. Nothing outside Core should invent its own way of keeping the copies
 * together; it picks the tool here that matches what it draws:
 *
 * - `SharedState` — what is on screen. Copies draw from it, clicks write to it.
 * - `CopySync` — a widget with its own view (a map's pan and zoom): one copy
 *   moves, the others follow in the same task.
 * - `CanvasMirror` — painted pixels (WebGL, 2D, an image): drawn once into a
 *   source, copied into every eye in one call.
 * - `frameClock` — the one animation loop; no second `requestAnimationFrame`.
 * - `twinsOf` / `markTwins` — browser state kept on one element only (hover,
 *   press), written onto the same element in every other copy.
 *
 * Also part of the same mechanism, elsewhere in Core: `StereoView` (mounts a
 * copy per eye and mirrors mouse hover), `ModuleScreenHost` (a plugin screen in
 * every eye), `SharedUiStore` and `ScrollBox` (Core's own panels), and
 * `runtime.media` (video decoded once, iframes locked to mono).
 */
export { CanvasMirror, type MirrorCopy, type MirrorSource } from "./CanvasMirror";
export { CopySync } from "./CopySync";
export { frameClock, type FrameListener } from "./FrameClock";
export { SharedState } from "./SharedState";
export { markTwins, twinsOf } from "./twins";

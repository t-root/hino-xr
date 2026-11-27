import * as THREE from "three";
import { withAccessKey } from "@/core/auth/accessKey";
import { isHandPointerId } from "@/core/input/dispatchHandPointer";
import { CanvasMirror, SharedState, frameClock } from "@/core/sync";
import { toLocalDelta, toLocalPoint } from "@/core/view/localPoint";
import { ENV } from "@/env";
import type { TwoHandDomDetail } from "@/shared/contracts/input";
import type { DetectionItem, FramePacket } from "@/shared/contracts/vision";
import type { Locale } from "@/shared/contracts/locale";
import { ALPHA, uiColorHex, voidHex } from "@/ui/theme";
import { spaceScannerCss } from "./styles";
import text from "./text.json";

const CROP_SIZE = 256;
const DEG = Math.PI / 180;
const BOX_RELEASE_SETTLE_MS = 420;
const MIN_BOX_SPAN = 0.06;

export type DrawBox = Readonly<{
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}>;

export type CadPart = Readonly<{
  shape: "box" | "cylinder" | "sphere";
  x: number;
  y: number;
  z: number;
  w: number;
  h: number;
  d: number;
}>;

export type CadSpec = Readonly<{
  name: string;
  kind: "lathe" | "box" | "sphere" | "composite";
  height: number;
  width: number;
  depth: number;
  hollowDepth: number;
  wallThickness: number;
  profile: readonly number[];
  handle: boolean;
  parts: readonly CadPart[];
}>;

type ScannerState = Readonly<{
  creating: boolean;
  analyzing: boolean;
  drawBox: DrawBox | null;
  autoSpin: boolean;
  hasModel: boolean;
  summary: string;
}>;

const AI_CAD_PROMPT = `Analyze the main object inside this cropped image and return ONLY a single valid JSON object (no markdown, no explanation) describing its 3D CAD geometry:
{
  "name": "short object name in Vietnamese and English",
  "kind": "lathe" | "box" | "sphere" | "composite",
  "height": <number 0.4..2.0, relative total height>,
  "width": <number 0.3..1.8, relative outer width/diameter>,
  "depth": <number 0.3..1.8, relative outer depth>,
  "hollowDepth": <number 0.0..0.92, fraction of height that is hollow inside from the top, e.g. 0.85 for a cup/mug/bowl/bottle, 0 for solid objects>,
  "wallThickness": <number 0.04..0.25, wall thickness if hollow>,
  "profile": [<7 outer radius ratios from bottom (index 0) to top rim (index 6), each 0.1..1.2, describing the exact curve of the body>],
  "handle": <true if it has a side handle like a mug/cup/pitcher, else false>,
  "parts": [
    {"shape":"box"|"cylinder"|"sphere","x":<-0.8..0.8>,"y":<-0.8..0.8>,"z":<-0.8..0.8>,"w":<0.1..1.5>,"h":<0.1..1.5>,"d":<0.1..1.5>}
  ]
}
Rules:
- Use "lathe" for cups, mugs, glasses, bottles, bowls, vases, cans, cylinders, plates. Set accurate "profile" radii from bottom to top, "hollowDepth" > 0 if open/hollow at top, and "handle": true if it has a handle.
- Use "box" for phones, laptops, books, boxes, keyboards, monitors, cards.
- Use "composite" when the object is made of 2-5 distinct sub-blocks in "parts".
- Output raw JSON only.`;

const clamp = (val: number, min: number, max: number): number => Math.min(max, Math.max(min, val));

const num = (raw: unknown, fallback: number, min: number, max: number): number => {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? clamp(n, min, max) : fallback;
};

export const parseCadSpec = (rawText: string): CadSpec | null => {
  const start = rawText.indexOf("{");
  const end = rawText.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = JSON.parse(rawText.slice(start, end + 1)) as Record<string, unknown>;
    const kindRaw = String(data.kind ?? "lathe").toLowerCase();
    const kind: CadSpec["kind"] =
      kindRaw === "box" || kindRaw === "sphere" || kindRaw === "composite" ? kindRaw : "lathe";
    const profileRaw = Array.isArray(data.profile) ? data.profile : [0.7, 0.75, 0.85, 0.92, 0.96, 1.0, 1.0];
    const profile = profileRaw.slice(0, 10).map((v) => num(v, 0.85, 0.08, 1.4));
    while (profile.length < 5) profile.push(0.9);

    const partsRaw = Array.isArray(data.parts) ? data.parts : [];
    const parts: CadPart[] = partsRaw.slice(0, 6).map((item) => {
      const p = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      const s = String(p.shape ?? "box").toLowerCase();
      return {
        shape: s === "cylinder" || s === "sphere" ? s : "box",
        x: num(p.x, 0, -1.2, 1.2),
        y: num(p.y, 0, -1.2, 1.2),
        z: num(p.z, 0, -1.2, 1.2),
        w: num(p.w, 0.4, 0.05, 1.8),
        h: num(p.h, 0.4, 0.05, 1.8),
        d: num(p.d, 0.4, 0.05, 1.8),
      };
    });

    return {
      name: typeof data.name === "string" && data.name.trim() ? data.name.trim().slice(0, 48) : "3D Object",
      kind,
      height: num(data.height, 1.35, 0.3, 2.2),
      width: num(data.width, 1.0, 0.25, 2.0),
      depth: num(data.depth, 1.0, 0.25, 2.0),
      hollowDepth: num(data.hollowDepth, kind === "lathe" ? 0.82 : 0, 0, 0.95),
      wallThickness: num(data.wallThickness, 0.08, 0.03, 0.3),
      profile,
      handle: Boolean(data.handle),
      parts,
    };
  } catch {
    return null;
  }
};

export class SpaceScannerApp {
  readonly state = new SharedState<ScannerState>({
    creating: false,
    analyzing: false,
    drawBox: null,
    autoSpin: true,
    hasModel: false,
    summary: "",
  });

  readonly mirror = new CanvasMirror();
  private readonly views = new Set<ScannerEyeView>();
  private frameCanvas: OffscreenCanvas | null = null;
  private frameCtx: OffscreenCanvasRenderingContext2D | null = null;
  private hasFrame = false;

  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(46, 1, 0.1, 30);
  private readonly modelGroup = new THREE.Group();
  private readonly scannerRig = new THREE.Group();
  private readonly stageGroup = new THREE.Group();
  private rigOuterCube: THREE.LineSegments | null = null;
  private rigCorners: THREE.LineSegments | null = null;
  private rigMidCube: THREE.LineSegments | null = null;
  private rigInnerCube: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private rigInnerWire: THREE.LineSegments | null = null;
  private rigStruts: THREE.LineSegments | null = null;
  private rigLaserGrid: THREE.LineSegments | null = null;
  private rigLaserFill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private scanPhase = 0;

  private active = false;
  private stopClock: (() => void) | null = null;
  private baseAlpha: number | null = null;
  private imuYaw = 0;
  private imuPitch = 0;

  private scale = 0.5;
  private rotX = 0.32;
  private rotY = -0.45;
  private pulseBoost = 0;
  private requestToken = 0;
  private aiAbort: AbortController | null = null;
  private pendingCommitElapsedMs: number | null = null;

  constructor(
    private readonly locale: () => Locale,
    readonly close: () => void,
  ) {
    this.buildStage();
  }

  words(): typeof text {
    return text;
  }

  lang(): Locale {
    return this.locale();
  }

  mount(element: HTMLElement): () => void {
    const view = new ScannerEyeView(this);
    this.views.add(view);
    element.append(view.root);
    this.mirror.present();
    return () => {
      this.views.delete(view);
      view.dispose();
    };
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) {
      window.addEventListener("deviceorientation", this.onOrientation);
      this.stopClock = frameClock.onFrame((_nowMs, deltaMs) => this.tick(deltaMs));
      this.tick(16);
    } else {
      window.removeEventListener("deviceorientation", this.onOrientation);
      this.stopClock?.();
      this.stopClock = null;
      this.requestToken += 1;
      this.aiAbort?.abort();
      this.aiAbort = null;
      this.pendingCommitElapsedMs = null;
      this.scannerRig.visible = false;
    }
  }

  toggleCreateMode(): void {
    const current = this.state.get();
    if (current.analyzing) return;
    this.pendingCommitElapsedMs = null;
    if (!current.creating && current.hasModel) {
      this.disposeModelChildren();
      this.scannerRig.visible = false;
      this.state.set({
        creating: true,
        hasModel: false,
        drawBox: null,
        summary: "",
      });
      this.tick(16);
      return;
    }
    this.state.set({
      creating: !current.creating,
      drawBox: null,
    });
  }

  setDrawBox(a: { u: number; v: number }, b: { u: number; v: number }, done: boolean, immediate = false): void {
    if (!this.state.get().creating) return;
    const x0 = Math.max(0.02, Math.min(0.98, Math.min(a.u, b.u)));
    const y0 = Math.max(0.02, Math.min(0.98, Math.min(a.v, b.v)));
    const x1 = Math.max(0.02, Math.min(0.98, Math.max(a.u, b.u)));
    const y1 = Math.max(0.02, Math.min(0.98, Math.max(a.v, b.v)));

    if (!done) {
      this.pendingCommitElapsedMs = null;
      this.state.set({ drawBox: { x0, y0, x1, y1 } });
      return;
    }

    if (x1 - x0 < MIN_BOX_SPAN || y1 - y0 < MIN_BOX_SPAN) {
      this.pendingCommitElapsedMs = null;
      this.state.set({ drawBox: null });
      return;
    }

    const region: DrawBox = { x0, y0, x1, y1 };
    if (immediate) {
      this.pendingCommitElapsedMs = null;
      this.commitDrawBox(region);
      return;
    }

    this.state.set({ drawBox: region });
    this.pendingCommitElapsedMs = 0;
  }

  private commitDrawBox(region: DrawBox): void {
    if (!this.state.get().creating) return;
    this.state.set({ creating: false, drawBox: null });
    void this.analyzeRegionWithAi(region);
  }

  toggleAutoSpin(): void {
    const current = this.state.get();
    this.state.set({ autoSpin: !current.autoSpin });
  }

  rotateModel(dxPx: number, dyPx: number): void {
    this.rotY += dxPx * 0.012;
    this.rotX = Math.max(-1.35, Math.min(1.35, this.rotX + dyPx * 0.012));
  }

  scaleAndTurn(scaleFactor: number, deltaTurnRad: number, panX = 0, panY = 0): void {
    this.scale = Math.max(0.22, Math.min(2.0, this.scale * scaleFactor));
    this.rotY += deltaTurnRad + panX * 0.008;
    this.rotX = Math.max(-1.35, Math.min(1.35, this.rotX + panY * 0.008));
  }

  analyzeFrame(frame: FramePacket): readonly DetectionItem[] {
    if (!this.frameCtx && typeof OffscreenCanvas !== "undefined") {
      try {
        this.frameCanvas = new OffscreenCanvas(CROP_SIZE, CROP_SIZE);
        this.frameCtx = this.frameCanvas.getContext("2d", { willReadFrequently: true });
      } catch {
        this.frameCtx = null;
      }
    }
    if (this.frameCtx) {
      try {
        this.frameCtx.drawImage(frame.image, 0, 0, CROP_SIZE, CROP_SIZE);
        this.hasFrame = true;
      } catch {
      }
    }
    return [];
  }

  dispose(): void {
    this.setActive(false);
    this.requestToken += 1;
    this.aiAbort?.abort();
    this.aiAbort = null;
    for (const view of [...this.views]) view.dispose();
    this.views.clear();
    this.disposeModelChildren();
    this.mirror.dispose();
    this.renderer?.dispose();
    this.renderer?.forceContextLoss();
    this.renderer = null;
  }

  private async cropRegionJpegDataUri(box: DrawBox): Promise<string | null> {
    if (!this.frameCanvas || !this.frameCtx || !this.hasFrame) return null;
    const sx = Math.floor(box.x0 * CROP_SIZE);
    const sy = Math.floor(box.y0 * CROP_SIZE);
    const sw = Math.max(16, Math.ceil((box.x1 - box.x0) * CROP_SIZE));
    const sh = Math.max(16, Math.ceil((box.y1 - box.y0) * CROP_SIZE));

    try {
      const out = new OffscreenCanvas(224, 224);
      const ctx = out.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(this.frameCanvas, sx, sy, sw, sh, 0, 0, 224, 224);
      const blob = await out.convertToBlob({ type: "image/jpeg", quality: 0.84 });
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 1) {
        binary += String.fromCharCode(bytes[i] ?? 0);
      }
      return `data:image/jpeg;base64,${btoa(binary)}`;
    } catch {
      return null;
    }
  }

  private fallbackSpecFromBox(box: DrawBox): CadSpec {
    const aspect = (box.y1 - box.y0) / Math.max(0.05, box.x1 - box.x0);
    if (!this.frameCtx || !this.hasFrame) {
      return {
        name: "3D Vessel",
        kind: "lathe",
        height: clamp(aspect * 1.1, 0.7, 1.8),
        width: 1.0,
        depth: 1.0,
        hollowDepth: 0.84,
        wallThickness: 0.08,
        profile: [0.68, 0.74, 0.84, 0.92, 0.97, 1.0, 1.0],
        handle: false,
        parts: [],
      };
    }

    const sx = Math.floor(box.x0 * CROP_SIZE);
    const sy = Math.floor(box.y0 * CROP_SIZE);
    const sw = Math.max(16, Math.min(CROP_SIZE - sx, Math.ceil((box.x1 - box.x0) * CROP_SIZE)));
    const sh = Math.max(16, Math.min(CROP_SIZE - sy, Math.ceil((box.y1 - box.y0) * CROP_SIZE)));
    const img = this.frameCtx.getImageData(sx, sy, sw, sh).data;

    // Extract 7 horizontal slices from bottom to top to measure real object silhouette width profile
    const slices = 7;
    const profile: number[] = [];
    for (let s = 0; s < slices; s += 1) {
      const rowY = Math.min(sh - 1, Math.max(0, Math.floor((1 - (s + 0.5) / slices) * sh)));
      const borderR = img[rowY * sw * 4] ?? 0;
      const borderG = img[rowY * sw * 4 + 1] ?? 0;
      const borderB = img[rowY * sw * 4 + 2] ?? 0;
      let left = 0;
      let right = sw - 1;
      for (let x = 0; x < sw; x += 1) {
        const idx = (rowY * sw + x) * 4;
        if (Math.hypot((img[idx] ?? 0) - borderR, (img[idx + 1] ?? 0) - borderG, (img[idx + 2] ?? 0) - borderB) > 32) {
          left = x;
          break;
        }
      }
      for (let x = sw - 1; x >= left; x -= 1) {
        const idx = (rowY * sw + x) * 4;
        if (Math.hypot((img[idx] ?? 0) - borderR, (img[idx + 1] ?? 0) - borderG, (img[idx + 2] ?? 0) - borderB) > 32) {
          right = x;
          break;
        }
      }
      const spanRatio = clamp((right - left + 1) / sw, 0.25, 1.15);
      profile.push(Number(spanRatio.toFixed(2)));
    }

    return {
      name: "3D Profile",
      kind: "lathe",
      height: clamp(aspect * 1.15, 0.65, 1.85),
      width: 1.0,
      depth: 1.0,
      hollowDepth: 0.82,
      wallThickness: 0.08,
      profile,
      handle: false,
      parts: [],
    };
  }

  private async analyzeRegionWithAi(box: DrawBox): Promise<void> {
    const token = ++this.requestToken;
    this.aiAbort?.abort();
    const controller = new AbortController();
    this.aiAbort = controller;
    this.disposeModelChildren();
    this.scanPhase = 0;
    this.scannerRig.visible = true;
    this.state.set({
      analyzing: true,
      hasModel: false,
      summary: this.words().analyzing[this.lang()],
    });
    this.tick(16);

    const dataUri = await this.cropRegionJpegDataUri(box);
    if (!dataUri || token !== this.requestToken) {
      if (token === this.requestToken) {
        this.scannerRig.visible = false;
        this.state.set({ analyzing: false, summary: "" });
        this.tick(16);
      }
      return;
    }

    try {
      const response = await fetch(
        `${ENV.BASE_URL}api/plugin-ai/chat`,
        withAccessKey({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            maxTokens: 360,
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: dataUri } },
                  { type: "text", text: AI_CAD_PROMPT },
                ],
              },
            ],
          }),
        }),
      );

      if (token !== this.requestToken) return;
      if (response.ok) {
        const payload = (await response.json()) as { text?: string };
        const parsed = parseCadSpec(payload.text ?? "");
        if (parsed) {
          this.scannerRig.visible = false;
          this.buildCadHologram(parsed);
          this.pulseBoost = 1;
          this.scale = 0.5;
          this.rotX = 0.32;
          this.rotY = -0.45;
          const hollowNote = parsed.hollowDepth > 0 ? ` · depth ${Math.round(parsed.hollowDepth * 100)}%` : "";
          this.state.set({
            analyzing: false,
            hasModel: true,
            summary: `${parsed.name} (${parsed.kind}${hollowNote})`,
          });
          this.tick(16);
          return;
        }
      }
    } catch {
    }

    if (token === this.requestToken) {
      const fallback = this.fallbackSpecFromBox(box);
      this.scannerRig.visible = false;
      this.buildCadHologram(fallback);
      this.pulseBoost = 1;
      this.scale = 0.5;
      this.state.set({
        analyzing: false,
        hasModel: true,
        summary: `${fallback.name} (hollow ${Math.round(fallback.hollowDepth * 100)}%)`,
      });
      this.tick(16);
    }
  }

  private buildCadHologram(spec: CadSpec): void {
    this.disposeModelChildren();
    const color = uiColorHex();

    const addHologramMesh = (geometry: THREE.BufferGeometry, x = 0, y = 0, z = 0): void => {
      const solid = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: ALPHA.surfaceStrong,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      solid.position.set(x, y, z);

      const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(geometry, 8),
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.92,
        }),
      );
      edges.position.set(x, y, z);
      this.modelGroup.add(solid, edges);
    };

    if (spec.kind === "box") {
      const geo = new THREE.BoxGeometry(spec.width, spec.height, spec.depth, 4, 4, 4);
      addHologramMesh(geo);
    } else if (spec.kind === "sphere") {
      const geo = new THREE.SphereGeometry(spec.width * 0.55, 24, 18);
      geo.scale(1, spec.height / Math.max(0.2, spec.width), spec.depth / Math.max(0.2, spec.width));
      addHologramMesh(geo);
    } else if (spec.kind === "composite" && spec.parts.length > 0) {
      for (const part of spec.parts) {
        if (part.shape === "cylinder") {
          addHologramMesh(new THREE.CylinderGeometry(part.w / 2, part.d / 2, part.h, 24, 3), part.x, part.y, part.z);
        } else if (part.shape === "sphere") {
          addHologramMesh(new THREE.SphereGeometry(part.w / 2, 18, 14), part.x, part.y, part.z);
        } else {
          addHologramMesh(new THREE.BoxGeometry(part.w, part.h, part.d, 2, 2, 2), part.x, part.y, part.z);
        }
      }
    } else {
      // Parametric Lathe with outer curvature, wall thickness, and inner hollow cavity!
      const h = spec.height;
      const halfH = h / 2;
      const baseR = spec.width * 0.5;
      const prof = spec.profile;
      const n = prof.length;
      const pts: THREE.Vector2[] = [];

      // 1. Center of outer bottom
      pts.push(new THREE.Vector2(0, -halfH));

      // 2. Outer wall curvature from bottom (index 0) to top rim (index n-1)
      for (let i = 0; i < n; i += 1) {
        const t = i / Math.max(1, n - 1);
        const r = Math.max(0.06, (prof[i] ?? 0.85) * baseR);
        const y = -halfH + t * h;
        pts.push(new THREE.Vector2(r, y));
      }

      // 3. If hollow inside (like a cup, glass, mug, bowl, vase, bottle), trace the inner wall down to hollowDepth!
      if (spec.hollowDepth > 0.05) {
        const wall = clamp(spec.wallThickness * baseR * 1.4, 0.03, baseR * 0.45);
        const innerFloorY = halfH - spec.hollowDepth * h;
        for (let i = n - 1; i >= 0; i -= 1) {
          const t = i / Math.max(1, n - 1);
          const y = -halfH + t * h;
          if (y < innerFloorY) continue;
          const outerR = Math.max(0.06, (prof[i] ?? 0.85) * baseR);
          const innerR = Math.max(0.02, outerR - wall);
          pts.push(new THREE.Vector2(innerR, y));
        }
        // Center of inner bottom floor
        pts.push(new THREE.Vector2(0, innerFloorY));
      } else {
        pts.push(new THREE.Vector2(0, halfH));
      }

      const latheGeo = new THREE.LatheGeometry(pts, 32);
      if (Math.abs(spec.depth - spec.width) > 0.08) {
        latheGeo.scale(1, 1, spec.depth / Math.max(0.2, spec.width));
      }
      addHologramMesh(latheGeo);

      // 4. Optional side handle (e.g. mug, cup, pitcher)
      if (spec.handle) {
        const midR = ((prof[Math.floor(n / 2)] ?? 0.9) * baseR);
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(midR * 0.92, h * 0.24, 0),
          new THREE.Vector3(midR + baseR * 0.48, h * 0.2, 0),
          new THREE.Vector3(midR + baseR * 0.5, -h * 0.16, 0),
          new THREE.Vector3(midR * 0.9, -h * 0.24, 0),
        ]);
        const handleGeo = new THREE.TubeGeometry(curve, 20, Math.max(0.035, baseR * 0.09), 10, false);
        addHologramMesh(handleGeo);
      }
    }

    this.state.set({ hasModel: true });
  }

  private disposeModelChildren(): void {
    for (const child of [...this.modelGroup.children]) {
      this.modelGroup.remove(child);
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.Material>;
      mesh.geometry?.dispose();
      mesh.material?.dispose();
    }
  }

  private readonly onOrientation = (event: DeviceOrientationEvent): void => {
    if (event.alpha === null || event.beta === null) return;
    if (this.baseAlpha === null) this.baseAlpha = event.alpha;
    let dyaw = event.alpha - this.baseAlpha;
    while (dyaw > 180) dyaw -= 360;
    while (dyaw < -180) dyaw += 360;
    this.imuYaw = dyaw * 0.35;
    this.imuPitch = Math.max(-25, Math.min(25, (event.beta - 65) * 0.25));
  };

  private buildStage(): void {
    this.camera.position.set(0, 0.2, 3.4);
    this.camera.lookAt(0, 0, 0);
    this.scene.add(this.stageGroup);
    this.stageGroup.add(this.modelGroup, this.scannerRig);

    const color = uiColorHex();

    // 1. Outer cube cage with subdivided grid lines
    const outerBox = new THREE.BoxGeometry(1.36, 1.36, 1.36, 2, 2, 2);
    this.rigOuterCube = new THREE.LineSegments(
      new THREE.EdgesGeometry(outerBox),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.72 }),
    );

    // 2. Heavy L-shaped corner brackets around the outer cube (Tesseract corners)
    const bracketPts: number[] = [];
    const half = 0.76;
    const arm = 0.24;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          const cx = sx * half;
          const cy = sy * half;
          const cz = sz * half;
          bracketPts.push(cx, cy, cz, cx - sx * arm, cy, cz);
          bracketPts.push(cx, cy, cz, cx, cy - sy * arm, cz);
          bracketPts.push(cx, cy, cz, cx, cy, cz - sz * arm);
        }
      }
    }
    const cornerGeo = new THREE.BufferGeometry();
    cornerGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(bracketPts), 3));
    this.rigCorners = new THREE.LineSegments(
      cornerGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }),
    );

    // 3. Diagonal hypercube (Tesseract) struts connecting outer corners to inner frame
    const strutPts: number[] = [];
    const hOut = 0.68;
    const hIn = 0.34;
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          strutPts.push(sx * hOut, sy * hOut, sz * hOut, sx * hIn, sy * hIn, sz * hIn);
        }
      }
    }
    const strutGeo = new THREE.BufferGeometry();
    strutGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(strutPts), 3));
    this.rigStruts = new THREE.LineSegments(
      strutGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 }),
    );

    // 4. Counter-rotating middle cube matrix
    const midBox = new THREE.BoxGeometry(0.86, 0.86, 0.86);
    this.rigMidCube = new THREE.LineSegments(
      new THREE.EdgesGeometry(midBox),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.88 }),
    );

    // 5. Pulsing inner quantum cube core (translucent solid + bright wireframe)
    const innerGeo = new THREE.BoxGeometry(0.44, 0.44, 0.44);
    this.rigInnerCube = new THREE.Mesh(
      innerGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.25,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.rigInnerWire = new THREE.LineSegments(
      new THREE.EdgesGeometry(innerGeo),
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1 }),
    );

    // 6. Square laser grid slicer sweeping vertically inside the cube
    const gridPts: number[] = [];
    const gHalf = 0.66;
    const steps = 6;
    for (let i = 0; i <= steps; i += 1) {
      const t = -gHalf + (i / steps) * (gHalf * 2);
      gridPts.push(-gHalf, 0, t, gHalf, 0, t);
      gridPts.push(t, 0, -gHalf, t, 0, gHalf);
    }
    const laserGridGeo = new THREE.BufferGeometry();
    laserGridGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(gridPts), 3));
    this.rigLaserGrid = new THREE.LineSegments(
      laserGridGeo,
      new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 }),
    );
    const planeGeo = new THREE.PlaneGeometry(gHalf * 2, gHalf * 2);
    planeGeo.rotateX(Math.PI / 2);
    this.rigLaserFill = new THREE.Mesh(
      planeGeo,
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );

    this.scannerRig.add(
      this.rigOuterCube,
      this.rigCorners,
      this.rigStruts,
      this.rigMidCube,
      this.rigInnerCube,
      this.rigInnerWire,
      this.rigLaserGrid,
      this.rigLaserFill,
    );
    this.scannerRig.scale.setScalar(0.45);
    this.scannerRig.visible = false;
  }

  private ensureRenderer(): THREE.WebGLRenderer | null {
    if (this.renderer) return this.renderer;
    if (typeof document === "undefined") return null;
    try {
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "high-performance" });
      renderer.setClearColor(voidHex(), 0);
      renderer.setSize(320, 320, false);
      this.mirror.setSource(renderer.domElement);
      this.renderer = renderer;
      return renderer;
    } catch {
      return null;
    }
  }

  private tick(deltaMs: number): void {
    const current = this.state.get();
    if (this.pendingCommitElapsedMs !== null) {
      if (!current.creating || !current.drawBox) {
        this.pendingCommitElapsedMs = null;
      } else {
        this.pendingCommitElapsedMs += Math.max(0, deltaMs);
        if (this.pendingCommitElapsedMs >= BOX_RELEASE_SETTLE_MS) {
          const region = current.drawBox;
          this.pendingCommitElapsedMs = null;
          this.commitDrawBox(region);
        }
      }
    }

    const renderer = this.ensureRenderer();
    if (!renderer) return;

    const dt = Math.min(0.1, Math.max(0.001, deltaMs / 1000));
    const color = uiColorHex();

    for (const child of this.modelGroup.children) {
      const mesh = child as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial | THREE.LineBasicMaterial>;
      mesh.material.color.setHex(color);
      if (mesh instanceof THREE.Mesh) {
        mesh.material.opacity = Math.min(0.65, ALPHA.surfaceStrong + this.pulseBoost * 0.35);
      }
    }

    if (this.pulseBoost > 0) {
      this.pulseBoost = Math.max(0, this.pulseBoost - dt * 2.5);
    }

    if (this.scannerRig.visible) {
      this.scanPhase += dt;
      this.scannerRig.rotation.y += dt * 0.75;
      this.scannerRig.rotation.x = Math.sin(this.scanPhase * 1.4) * 0.22 + 0.25;

      const breath = 1 + Math.sin(this.scanPhase * 5) * 0.06;
      if (this.rigOuterCube) {
        (this.rigOuterCube.material as THREE.LineBasicMaterial).color.setHex(color);
      }
      if (this.rigCorners) {
        (this.rigCorners.material as THREE.LineBasicMaterial).color.setHex(color);
        this.rigCorners.scale.setScalar(breath);
      }
      if (this.rigStruts) {
        (this.rigStruts.material as THREE.LineBasicMaterial).color.setHex(color);
      }
      if (this.rigMidCube) {
        (this.rigMidCube.material as THREE.LineBasicMaterial).color.setHex(color);
        this.rigMidCube.rotation.x += dt * 1.9;
        this.rigMidCube.rotation.y -= dt * 2.3;
        this.rigMidCube.rotation.z += dt * 1.2;
      }
      const corePulse = 0.86 + Math.sin(this.scanPhase * 8) * 0.18;
      if (this.rigInnerCube && this.rigInnerWire) {
        this.rigInnerCube.material.color.setHex(color);
        (this.rigInnerWire.material as THREE.LineBasicMaterial).color.setHex(color);
        this.rigInnerCube.rotation.x -= dt * 3.1;
        this.rigInnerCube.rotation.y += dt * 2.7;
        this.rigInnerWire.rotation.copy(this.rigInnerCube.rotation);
        this.rigInnerCube.scale.setScalar(corePulse);
        this.rigInnerWire.scale.setScalar(corePulse);
      }
      const sliceY = Math.sin(this.scanPhase * 4.2) * 0.62;
      if (this.rigLaserGrid) {
        (this.rigLaserGrid.material as THREE.LineBasicMaterial).color.setHex(color);
        this.rigLaserGrid.position.y = sliceY;
      }
      if (this.rigLaserFill) {
        this.rigLaserFill.material.color.setHex(color);
        this.rigLaserFill.position.y = sliceY;
      }
    }

    if (current.autoSpin && current.hasModel) {
      this.rotY += dt * 0.85;
    }

    const popScale = this.scale * (1 + this.pulseBoost * 0.14);
    this.modelGroup.scale.setScalar(popScale);
    this.modelGroup.rotation.set(
      this.rotX + this.imuPitch * DEG,
      this.rotY + this.imuYaw * DEG,
      0,
    );

    renderer.render(this.scene, this.camera);
    this.mirror.present();
  }
}

class ScannerEyeView {
  readonly root: HTMLDivElement;
  private readonly copy;
  private readonly offState: () => void;
  private dragging: { id: number; lastX: number; lastY: number } | null = null;
  private drawStart: { u: number; v: number } | null = null;

  constructor(private readonly app: SpaceScannerApp) {
    this.root = document.createElement("div");
    this.root.className = "ar-space";

    const style = document.createElement("style");
    style.textContent = spaceScannerCss();

    const stage = document.createElement("div");
    stage.className = "ar-space__stage";
    stage.dataset.handTarget = "ar-space-stage";
    stage.dataset.handPlain = "";
    this.copy = this.app.mirror.attach();
    stage.append(this.copy.canvas);

    const box = document.createElement("div");
    box.className = "ar-space__box";
    box.hidden = true;

    const specBadge = document.createElement("div");
    specBadge.className = "ar-space__spec";
    specBadge.hidden = true;

    const bar = document.createElement("div");
    bar.className = "ar-space__bar";

    const makeBtn = (key: "createModel" | "autoSpin" | "close", onClick: () => void) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ar-space__btn";
      btn.dataset.handTarget = `ar-space-${key}`;
      btn.textContent = this.app.words()[key][this.app.lang()];
      btn.addEventListener("click", (event) => {
        event.stopPropagation();
        onClick();
      });
      return { btn, key };
    };

    const btnCreate = makeBtn("createModel", () => this.app.toggleCreateMode());
    const btnSpin = makeBtn("autoSpin", () => this.app.toggleAutoSpin());
    const btnClose = makeBtn("close", () => this.app.close());
    const buttons = [btnCreate, btnSpin, btnClose];
    for (const item of buttons) bar.append(item.btn);

    this.root.append(style, stage, box, bar, specBadge);

    const uvAt = (clientX: number, clientY: number): { u: number; v: number } => {
      const rect = stage.getBoundingClientRect();
      const local = toLocalPoint(stage, clientX, clientY);
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      return {
        u: Math.max(0, Math.min(1, local.x / w)),
        v: Math.max(0, Math.min(1, local.y / h)),
      };
    };

    stage.addEventListener("pointerdown", (event) => {
      if (isHandPointerId(event.pointerId)) event.stopImmediatePropagation();
      if (this.app.state.get().creating && !isHandPointerId(event.pointerId)) {
        this.drawStart = uvAt(event.clientX, event.clientY);
        this.app.setDrawBox(this.drawStart, this.drawStart, false);
        return;
      }
      this.dragging = {
        id: event.pointerId,
        lastX: event.clientX,
        lastY: event.clientY,
      };
    });

    stage.addEventListener("pointermove", (event) => {
      if (this.drawStart) {
        this.app.setDrawBox(this.drawStart, uvAt(event.clientX, event.clientY), false);
        return;
      }
      if (!this.dragging || this.dragging.id !== event.pointerId) return;
      if (isHandPointerId(event.pointerId)) event.stopImmediatePropagation();
      const delta = toLocalDelta(stage, event.clientX - this.dragging.lastX, event.clientY - this.dragging.lastY);
      this.dragging.lastX = event.clientX;
      this.dragging.lastY = event.clientY;
      this.app.rotateModel(delta.x, delta.y);
    });

    const endDrag = (event: PointerEvent) => {
      if (this.drawStart) {
        this.app.setDrawBox(this.drawStart, uvAt(event.clientX, event.clientY), true, true);
        this.drawStart = null;
        return;
      }
      if (this.dragging && this.dragging.id === event.pointerId) {
        this.dragging = null;
      }
    };
    stage.addEventListener("pointerup", endDrag);
    stage.addEventListener("pointercancel", () => {
      this.drawStart = null;
      this.dragging = null;
    });

    stage.addEventListener("wheel", (event) => {
      event.preventDefault();
      const factor = event.deltaY < 0 ? 1.08 : 0.92;
      this.app.scaleAndTurn(factor, 0);
    });

    this.root.addEventListener("twohand", (rawEvent) => {
      const event = rawEvent as CustomEvent<TwoHandDomDetail>;
      event.preventDefault();
      const detail = event.detail;
      if (!detail) return;
      if (this.app.state.get().creating) {
        const leftUv = uvAt(detail.hands.left.x, detail.hands.left.y);
        const rightUv = uvAt(detail.hands.right.x, detail.hands.right.y);
        this.app.setDrawBox(leftUv, rightUv, detail.phase === "end");
      } else if (detail.phase === "move") {
        const pan = toLocalDelta(stage, detail.pan.x * 100, detail.pan.y * 100);
        this.app.scaleAndTurn(detail.scale, detail.rotation, pan.x, pan.y);
      }
    });

    const renderHud = () => {
      const state = this.app.state.get();
      const lang = this.app.lang();
      const w = this.app.words();
      btnCreate.btn.textContent = state.analyzing
        ? w.analyzing[lang]
        : state.hasModel
          ? w.createNew[lang]
          : w.createModel[lang];
      btnSpin.btn.textContent = w.autoSpin[lang];
      btnClose.btn.textContent = w.close[lang];
      btnCreate.btn.dataset.active = String(state.creating || state.analyzing);
      btnSpin.btn.dataset.active = String(state.autoSpin);

      if (state.summary) {
        specBadge.hidden = false;
        specBadge.textContent = state.summary;
      } else {
        specBadge.hidden = true;
      }

      if (state.drawBox) {
        box.hidden = false;
        box.style.left = `${(state.drawBox.x0 * 100).toFixed(1)}%`;
        box.style.top = `${(state.drawBox.y0 * 100).toFixed(1)}%`;
        box.style.width = `${((state.drawBox.x1 - state.drawBox.x0) * 100).toFixed(1)}%`;
        box.style.height = `${((state.drawBox.y1 - state.drawBox.y0) * 100).toFixed(1)}%`;
      } else {
        box.hidden = true;
      }
    };

    renderHud();
    this.offState = this.app.state.subscribe(renderHud);
  }

  dispose(): void {
    this.offState();
    this.copy.detach();
    this.root.remove();
  }
}

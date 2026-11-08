import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CanvasMirror, SharedState, frameClock } from "@/core/sync";
import { isHandPointerId } from "@/core/input/dispatchHandPointer";
import type { TwoHandDomDetail } from "@/shared/contracts/input";
import { queryOverpass, type OsmElement } from "./overpass";
import { cHex } from "./palette";
import type { LatLng } from "./SelectMap";
import { h, type Words } from "./ui";

/** Scene units per degree, as in the original. */
const scale = 51000;
const DEG = Math.PI / 180;

export type Building = {
  id: number;
  tags: Record<string, string | undefined>;
  geometry?: LatLng[];
};

type Vec3 = { x: number; y: number; z: number };

/** Where the original store started, before any area was chosen. */
const DEFAULT_CENTER: readonly LatLng[] = [
  { lat: 40.8, lng: -73.95 },
  { lat: 40.83, lng: -73.88 },
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const disposeTree = (root: THREE.Object3D): void => {
  root.traverse((object) => {
    const mesh = object as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material?.dispose();
  });
};

/** What a building needs from the scene it stands in. */
interface BuildingHost {
  readonly words: Words;
  setCameraControl(enabled: boolean): void;
  select(id: number): void;
  setCursor(cursor: string): void;
  groundPoint(event: { clientX: number; clientY: number }): THREE.Vector3 | null;
  capture(pointerId: number, building: BuildingView): void;
  release(pointerId: number): void;
  setBuildingScale(id: number, value: Vec3): void;
  setBuildingPosition(id: number, value: Vec3): void;
}

/**
 * One extruded building with the original's behaviour: hover lights it up,
 * a press selects it, and once selected a drag moves it over the ground and two
 * fingers resize it — wider when they spread sideways, taller when they spread
 * up and down.
 */
class BuildingView {
  readonly group = new THREE.Group();
  readonly mesh: THREE.Mesh<THREE.ExtrudeGeometry, THREE.MeshStandardMaterial>;

  private readonly edges: THREE.LineSegments<THREE.EdgesGeometry, THREE.LineBasicMaterial>;
  private readonly depth: number;

  private hovered = false;
  private selected = false;
  private interaction: "move" | "resize" | null = null;
  private moveOffset: THREE.Vector3 | null = null;
  private readonly touchPoints = new Map<number, { x: number; y: number }>();
  private pinchStart: { spanX: number; spanY: number; scale: Vec3 } | null = null;

  constructor(
    readonly id: number,
    shape: THREE.Shape,
    depth: number,
    private readonly tags: Record<string, string | undefined>,
    private buildingScale: Vec3,
    position: Vec3,
    private readonly host: BuildingHost,
  ) {
    this.depth = depth;
    this.group.position.set(position.x, position.y, position.z);
    this.group.scale.set(buildingScale.x, buildingScale.y, buildingScale.z);

    const geometry = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false });
    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ transparent: true, roughness: 0.12, metalness: 0.35, side: THREE.DoubleSide }),
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 12), new THREE.LineBasicMaterial());
    this.edges.raycast = () => {};
    this.mesh.add(this.edges);
    this.group.add(this.mesh);
    this.applyLook();
  }

  get labelVisible(): boolean {
    return this.hovered || this.selected || this.interaction !== null;
  }

  /** The three lines of the label, in the language the interface is in. */
  labelText(): readonly [string, string, string] {
    const words = this.host.words;
    const status = words.get(
      this.interaction === "move"
        ? "moving"
        : this.interaction === "resize"
          ? "resizing"
          : this.selected
            ? "selected"
            : "clickToSelect",
    );
    return [status, this.tags.name || words.get("urbanStructure"), words.get("editHint")];
  }

  /** Where the label hangs: above the roof, in world space. */
  labelAnchor(target: THREE.Vector3): THREE.Vector3 {
    return this.mesh.localToWorld(target.set(0, 0, this.depth + 1.5));
  }

  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.applyLook();
  }

  applyLook(): void {
    // A selected building stays lit, as under the mouse, so it is plain which one the tools act on.
    const hovered = this.hovered || this.selected;
    const material = this.mesh.material;
    material.color.setHex(hovered ? cHex(185, 252, 255) : cHex(12, 152, 184));
    material.emissive.setHex(hovered ? cHex(105, 248, 255) : cHex(0, 107, 136));
    material.emissiveIntensity = hovered ? 2.8 : 1.5;
    material.opacity = hovered ? 0.82 : 0.48;
    this.edges.material.color.setHex(hovered ? cHex(213, 254, 255) : cHex(72, 245, 255));
  }

  onPointerOver(): void {
    this.hovered = true;
    this.host.setCursor(this.selected ? "grab" : "pointer");
    this.applyLook();
  }

  onPointerOut(): void {
    if (!this.moveOffset && this.touchPoints.size < 2) {
      this.hovered = false;
      this.host.setCursor("default");
      this.applyLook();
    }
  }

  onPointerDown(event: PointerEvent): void {
    if (!this.selected) {
      this.host.setCameraControl(false);
      this.host.select(this.id);
      this.host.setCursor("grab");
      return;
    }
    this.host.setCameraControl(false);
    this.host.capture(event.pointerId, this);
    if (event.pointerType === "touch") {
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.touchPoints.size === 2) this.beginPinch();
      else this.beginMove(event);
    } else {
      this.beginMove(event);
      this.host.setCursor("grabbing");
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (event.pointerType === "touch") {
      this.touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.updatePinch();
    } else {
      this.updateMove(event);
    }
  }

  onPointerUp(event: PointerEvent): void {
    this.host.release(event.pointerId);
    this.moveOffset = null;
    if (event.pointerType === "touch") {
      this.touchPoints.delete(event.pointerId);
      this.pinchStart = null;
    }
    this.host.setCameraControl(true);
    this.setInteraction(null);
    this.host.setCursor(this.hovered ? "grab" : "default");
  }

  dispose(): void {
    disposeTree(this.group);
  }

  private setInteraction(interaction: "move" | "resize" | null): void {
    this.interaction = interaction;
    this.applyLook();
  }

  private beginMove(event: PointerEvent): void {
    const groundPoint = this.host.groundPoint(event);
    if (!groundPoint) return;
    this.moveOffset = this.group.position.clone().sub(groundPoint);
    this.setInteraction("move");
  }

  private updateMove(event: PointerEvent): void {
    if (!this.moveOffset) return;
    const groundPoint = this.host.groundPoint(event);
    if (!groundPoint) return;
    const position = groundPoint.add(this.moveOffset);
    this.group.position.set(position.x, 0, position.z);
    this.host.setBuildingPosition(this.id, { x: position.x, y: 0, z: position.z });
  }

  private beginPinch(): void {
    const [first, second] = Array.from(this.touchPoints.values());
    if (!first || !second) return;
    this.pinchStart = {
      spanX: Math.abs(second.x - first.x),
      spanY: Math.abs(second.y - first.y),
      scale: { ...this.buildingScale },
    };
    this.moveOffset = null;
    this.setInteraction("resize");
  }

  private updatePinch(): void {
    const [first, second] = Array.from(this.touchPoints.values());
    if (!first || !second || !this.pinchStart) return;
    const spanX = Math.abs(second.x - first.x);
    const spanY = Math.abs(second.y - first.y);
    const changeX = spanX - this.pinchStart.spanX;
    const changeY = spanY - this.pinchStart.spanY;
    if (Math.abs(changeX) >= Math.abs(changeY)) {
      const width = clamp(this.pinchStart.scale.x + changeX * 0.012, 0.35, 3.5);
      this.applyScale({ ...this.buildingScale, x: width, z: width });
    } else {
      const height = clamp(this.pinchStart.scale.y + changeY * 0.016, 0.3, 6);
      this.applyScale({ ...this.buildingScale, y: height });
    }
  }

  /** Hand tools: where the building stands and how big it is, set directly. */
  get position(): THREE.Vector3 {
    return this.group.position;
  }

  get size(): Vec3 {
    return { ...this.buildingScale };
  }

  placeAt(x: number, z: number): void {
    this.group.position.set(x, 0, z);
    this.host.setBuildingPosition(this.id, { x, y: 0, z });
  }

  resize(value: Vec3): void {
    this.applyScale(value);
  }

  private applyScale(value: Vec3): void {
    this.buildingScale = value;
    this.group.scale.set(value.x, value.y, value.z);
    this.host.setBuildingScale(this.id, value);
  }
}

/** A house a hand worked this recently, ms, is still the one a second hand joining means. */
const RECENT_HOUSE_MS = 1500;

type HandDrag = {
  pointerId: number;
  /** What the hand took hold of: the city (it slides) or a house (its height and width change). */
  kind: "scene" | "house";
  view: SpaceView;
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  building: BuildingView | null;
  startSize: Vec3 | null;
};

/** Where one building's label goes this frame; the same for every eye. */
type LabelPlacement = Readonly<{
  id: number;
  transform: string;
  zIndex: string;
  text: readonly [string, string, string];
}>;

/**
 * The original 3D stage, held once for every copy of the screen: one scene,
 * one camera, one set of buildings, and one WebGL canvas the frame is rendered
 * into. Each eye gets a `SpaceView` that copies that frame and places labels
 * from the same numbers, so the two eyes cannot show different moments
 * (rules.md: render once, draw twice).
 */
export class SpaceCore implements BuildingHost {
  readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 8000);
  /** Every eye's orbit controls turn about this one point. */
  readonly target = new THREE.Vector3();
  /** The one rendered frame, shown in every eye. */
  readonly mirror: CanvasMirror;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly ambient: THREE.AmbientLight;
  private readonly fog: THREE.Fog;
  private readonly raycaster = new THREE.Raycaster();
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly startedAt = performance.now();
  private readonly views = new Set<SpaceView>();

  private center: readonly LatLng[] = DEFAULT_CENTER;
  private areas: readonly Building[] = [];
  private showPlatform = false;
  private radius = 0;
  private selectedBuilding: number | null = null;
  private readonly buildingScales = new Map<number, Vec3>();
  private readonly buildingPositions = new Map<number, Vec3>();
  private buildings: BuildingView[] = [];
  /** Mesh to building, outside `userData`: three clones that as JSON on export. */
  private byMesh = new WeakMap<THREE.Object3D, BuildingView>();
  private roads: OsmElement[] = [];
  private readonly roadsGroup = Object.assign(new THREE.Group(), { visible: false });
  private floor: { group: THREE.Group; scan: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> } | null = null;
  private atmosphere: THREE.Group | null = null;
  private roadsAbort: AbortController | null = null;
  private roadsTimer = 0;
  private stopFrame: (() => void) | null = null;
  private controlsEnabled = true;
  private cursor = "default";

  /** What a hand's pinch-and-drag does; the same for every eye. */

  private hand: HandDrag | null = null;
  /** The house a hand last worked and when: a second hand closing right after is meant for that house, not the city. */
  private lastWorked: { building: BuildingView; at: number } | null = null;
  private readonly captures = new Map<number, { building: BuildingView; view: SpaceView }>();
  private hoveredView: BuildingView | null = null;
  private downAt: { x: number; y: number } | null = null;
  /** The eye whose element the event being handled arrived on. */
  private eventView: SpaceView | null = null;

  constructor(readonly words: Words) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mirror = new CanvasMirror(this.renderer.domElement);

    this.fog = new THREE.Fog(cHex(2, 9, 19), 1, 2);
    this.scene.fog = this.fog;
    this.ambient = new THREE.AmbientLight(cHex(25, 126, 153), 1.2);
    this.scene.add(this.ambient, this.roadsGroup);
    this.applyCenter();
  }

  get count(): number {
    return this.buildings.length;
  }

  // ---- copies ----

  createView(words: Words): SpaceView {
    const view = new SpaceView(this, words);
    this.configure(view.controls);
    view.root.style.cursor = this.cursor;
    this.views.add(view);
    return view;
  }

  dropView(view: SpaceView): void {
    this.views.delete(view);
    for (const [pointerId, capture] of this.captures) if (capture.view === view) this.captures.delete(pointerId);
    view.dispose();
  }

  // ---- what the app drives ----

  setCenter(center: readonly LatLng[]): void {
    this.center = center;
    this.applyCenter();
    this.scheduleRoads();
  }

  setAreas(areas: readonly Building[]): void {
    this.areas = areas;
    this.rebuildBuildings();
    this.frameCity();
  }

  /** Puts the loaded city in the middle of the view, whatever part of the box the buildings fill. */
  private frameCity(): void {
    if (this.buildings.length === 0) return;
    const box = new THREE.Box3();
    for (const building of this.buildings) box.expandByObject(building.group);
    if (box.isEmpty()) return;
    const centre = box.getCenter(new THREE.Vector3());
    centre.y = 0;
    const extent = box.getSize(new THREE.Vector3());
    const span = Math.max(Math.hypot(extent.x, extent.z), 10);
    const offset = this.camera.position.clone().sub(this.target);
    const fit = (span * 0.62) / Math.tan((this.camera.fov * DEG) / 2);
    offset.setLength(clamp(fit, 5, this.radius * 3));
    this.target.copy(centre);
    this.camera.position.copy(centre).add(offset);
    this.camera.lookAt(this.target);
  }

  setShowPlatform(show: boolean): void {
    if (this.showPlatform === show) return;
    this.showPlatform = show;
    // The roads are fetched as soon as an area is drawn, so they are ready for the city, but the city is
    // not on screen while the map is: drawn then, they show through under it.
    this.roadsGroup.visible = show;
    this.rebuildPlatform();
  }

  /** Rendering rides Core's one clock, so it lands in the same frame as everything else. */
  setRunning(running: boolean): void {
    if (running === (this.stopFrame !== null)) return;
    if (running) {
      this.stopFrame = frameClock.onFrame(this.tick);
    } else {
      this.stopFrame?.();
      this.stopFrame = null;
    }
  }

  applyPalette(): void {
    this.fog.color.setHex(cHex(2, 9, 19));
    this.ambient.color.setHex(cHex(25, 126, 153));
    for (const building of this.buildings) building.applyLook();
    this.rebuildRoads();
    this.rebuildPlatform();
  }

  dispose(): void {
    this.setRunning(false);
    window.clearTimeout(this.roadsTimer);
    this.roadsAbort?.abort();
    for (const view of [...this.views]) this.dropView(view);
    for (const building of this.buildings) building.dispose();
    this.buildings = [];
    disposeTree(this.scene);
    this.mirror.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---- BuildingHost ----

  setCameraControl(enabled: boolean): void {
    this.controlsEnabled = enabled;
    for (const view of this.views) view.controls.enabled = enabled;
  }

  select(id: number | null): void {
    this.selectedBuilding = id;
    for (const building of this.buildings) building.setSelected(building.id === id);
  }

  setCursor(cursor: string): void {
    this.cursor = cursor;
    for (const view of this.views) view.root.style.cursor = cursor;
  }

  groundPoint(event: { clientX: number; clientY: number }): THREE.Vector3 | null {
    const view = this.eventView;
    if (!view) return null;
    this.aim(event, view);
    const point = new THREE.Vector3();
    return this.raycaster.ray.intersectPlane(this.ground, point) ? point : null;
  }

  capture(pointerId: number, building: BuildingView): void {
    const view = this.eventView;
    if (!view) return;
    this.captures.set(pointerId, { building, view });
    view.capture(pointerId);
  }

  release(pointerId: number): void {
    const capture = this.captures.get(pointerId);
    this.captures.delete(pointerId);
    capture?.view.release(pointerId);
  }

  setBuildingScale(id: number, value: Vec3): void {
    this.buildingScales.set(id, value);
  }

  setBuildingPosition(id: number, value: Vec3): void {
    this.buildingPositions.set(id, value);
  }

  // ---- pointer routing (what react-three-fiber did), from whichever eye ----

  pointerDown(event: PointerEvent, view: SpaceView): void {
    this.eventView = view;
    this.downAt = { x: event.clientX, y: event.clientY };
    const building = this.pick(event, view);
    if (!building) return;
    this.setHovered(building);
    building.onPointerDown(event);
  }

  pointerMove(event: PointerEvent, view: SpaceView): void {
    const captured = this.captures.get(event.pointerId);
    if (captured) {
      this.eventView = captured.view;
      captured.building.onPointerMove(event);
      return;
    }
    this.eventView = view;
    const building = this.pick(event, view);
    this.setHovered(building);
    building?.onPointerMove(event);
  }

  pointerUp(event: PointerEvent, view: SpaceView): void {
    const captured = this.captures.get(event.pointerId);
    this.eventView = captured?.view ?? view;
    const building = captured?.building ?? this.pick(event, view);
    building?.onPointerUp(event);
    // The original left the camera locked when a press that selected a
    // building was released off it; nothing is held any more, so let go.
    if (this.captures.size === 0) this.setCameraControl(true);
  }

  // ---- a hand: what it does depends on what it took hold of ----

  /**
   * Pinching a house takes hold of that house (it is chosen, and dragging sets its height and width); pinching
   * anywhere else takes hold of the city (dragging slides it). There are no modes to pick: the hand is where
   * the thing is.
   */
  handDown(event: PointerEvent, view: SpaceView): void {
    if (this.hand) return;
    this.eventView = view;
    const house = this.pick(event, view);
    if (house && house.id !== this.selectedBuilding) this.select(house.id);
    if (house) this.lastWorked = { building: house, at: performance.now() };
    this.hand = {
      pointerId: event.pointerId,
      kind: house ? "house" : "scene",
      view,
      lastX: event.clientX,
      lastY: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      building: house,
      startSize: house?.size ?? null,
    };
  }

  handMove(event: PointerEvent): void {
    const drag = this.hand;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    if (drag.building) this.lastWorked = { building: drag.building, at: performance.now() };
    const { height } = drag.view.size();
    const h = Math.max(height, 1);
    if (drag.kind === "scene") {
      this.panBy(dx, dy, h);
      return;
    }
    // One hand on a house: up and down is how tall, left and right is how wide, in the same drag.
    if (!drag.building || !drag.startSize) return;
    const up = (drag.startY - event.clientY) / h;
    const out = (event.clientX - drag.startX) / h;
    const width = clamp(drag.startSize.x + out * 3.5, 0.35, 3.5);
    drag.building.resize({ x: width, y: clamp(drag.startSize.y + up * 6, 0.3, 6), z: width });
  }

  handUp(event: PointerEvent): void {
    if (this.hand?.pointerId === event.pointerId) this.hand = null;
  }

  private selectedView(): BuildingView | null {
    if (this.selectedBuilding === null) return null;
    return this.buildings.find((building) => building.id === this.selectedBuilding) ?? null;
  }

  /** Turns the one shared camera about the target; the angle is kept clear of straight up and the ground. */
  private orbitBy(yaw: number, pitch: number): void {
    const offset = this.camera.position.clone().sub(this.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta -= yaw;
    spherical.phi = clamp(spherical.phi - pitch, 0.05, Math.PI / 2.04);
    offset.setFromSpherical(spherical);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  /** Slides the view over the ground, so the city follows the hand. */
  private panBy(dx: number, dy: number, viewHeight: number): void {
    const distance = this.camera.position.distanceTo(this.target);
    const perPixel = (2 * distance * Math.tan((this.camera.fov * DEG) / 2)) / viewHeight;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    right.y = 0;
    right.normalize();
    const forward = new THREE.Vector3(-right.z, 0, right.x).negate();
    const move = right.multiplyScalar(-dx * perPixel).add(forward.multiplyScalar(-dy * perPixel));
    this.camera.position.add(move);
    this.target.add(move);
    this.camera.lookAt(this.target);
  }

  /** The house two hands are holding, and where it stands against where their midpoint lands on the ground. */
  private held: { building: BuildingView; offset: THREE.Vector3 } | null = null;

  /**
   * Two hands pinching, and what they mean depends on what is between them. Over a house they carry that house
   * across the ground. Over anything else, spreading them zooms the city in, closing them zooms it out, turning
   * them turns the city about its centre, and moving both up or down tilts the view. What is between the hands is
   * decided when they close and kept until they open. Recognised once in Core; this only says what it means here.
   */
  twoHand(step: TwoHandDomDetail, view: SpaceView): void {
    if (step.phase === "start") {
      this.eventView = view;
      // The house between the hands; failing that, the one a hand was working an instant ago. Closing the second
      // hand while the first holds a house is how a house is carried, and must never turn the city.
      const recent = this.lastWorked && performance.now() - this.lastWorked.at < RECENT_HOUSE_MS ? this.lastWorked.building : null;
      const house = this.pick({ clientX: step.client.x, clientY: step.client.y }, view) ?? recent;
      if (house && house.id !== this.selectedBuilding) this.select(house.id);
      const ground = house ? this.groundPoint({ clientX: step.client.x, clientY: step.client.y }) : null;
      this.held = house && ground ? { building: house, offset: house.position.clone().sub(ground) } : null;
      return;
    }
    if (step.phase === "end") {
      this.held = null;
      return;
    }
    if (this.held) {
      this.eventView = view;
      const ground = this.groundPoint({ clientX: step.client.x, clientY: step.client.y });
      if (ground) this.held.building.placeAt(ground.x + this.held.offset.x, ground.z + this.held.offset.z);
      return;
    }
    if (step.scale !== 1) this.zoomBy(1 / step.scale);
    this.orbitBy(-step.rotation, step.pan.y * Math.PI);
  }

  private zoomBy(factor: number): void {
    const offset = this.camera.position.clone().sub(this.target);
    const length = clamp(offset.length() * factor, 5, this.radius * 3);
    offset.setLength(length);
    this.camera.position.copy(this.target).add(offset);
  }

  pointerLeave(): void {
    if (this.captures.size === 0) this.setHovered(null);
  }

  /** `onPointerMissed`: a click (not a drag) that hit no building deselects. */
  click(event: MouseEvent, view: SpaceView): void {
    const start = this.downAt;
    const moved = start ? Math.hypot(event.clientX - start.x, event.clientY - start.y) : 0;
    if (moved <= 2 && !this.pick(event, view)) this.select(null);
  }

  private aim(event: { clientX: number; clientY: number }, view: SpaceView): void {
    const rect = view.canvas.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
    const y = -((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(x, y), this.camera);
  }

  private pick(event: { clientX: number; clientY: number }, view: SpaceView): BuildingView | null {
    if (this.buildings.length === 0) return null;
    this.aim(event, view);
    const hit = this.raycaster.intersectObjects(
      this.buildings.map((building) => building.mesh),
      false,
    )[0];
    return (hit && this.byMesh.get(hit.object)) ?? null;
  }

  private setHovered(building: BuildingView | null): void {
    if (building === this.hoveredView) return;
    this.hoveredView?.onPointerOut();
    this.hoveredView = building;
    building?.onPointerOver();
  }

  // ---- scene ----

  private configure(controls: OrbitControls): void {
    controls.target = this.target;
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.minDistance = 5;
    controls.maxDistance = this.radius * 3;
    controls.maxPolarAngle = Math.PI / 2.04;
    controls.enabled = this.controlsEnabled;
  }

  private reference() {
    const [first, second] = this.center;
    const a = first ?? DEFAULT_CENTER[0]!;
    const b = second ?? DEFAULT_CENTER[1]!;
    const refLat = (b.lat + a.lat) / 2;
    const refLng = (b.lng + a.lng) / 2;
    const radius = Math.max(
      12,
      Math.hypot((a.lng - b.lng) * scale * Math.cos(refLat * DEG), (a.lat - b.lat) * scale) * 0.72,
    );
    return { refLat, refLng, radius };
  }

  private applyCenter(): void {
    const { radius } = this.reference();
    if (radius !== this.radius) {
      this.radius = radius;
      this.camera.position.set(radius * 1.05, radius * 0.83, radius * 1.1);
      this.camera.lookAt(this.target);
      for (const view of this.views) view.controls.maxDistance = radius * 3;
      this.fog.near = radius * 3;
      this.fog.far = radius * 7;
      this.rebuildPlatform();
    }
    this.rebuildBuildings();
    this.rebuildRoads();
  }

  private rebuildBuildings(): void {
    for (const building of this.buildings) {
      building.group.removeFromParent();
      building.dispose();
    }
    this.buildings = [];
    this.byMesh = new WeakMap();
    this.captures.clear();
    this.hoveredView = null;

    const { refLat, refLng } = this.reference();
    this.areas.forEach((building, index) => {
      if (!building.geometry || building.geometry.length < 3) return;
      const points = building.geometry.map(
        (point) =>
          new THREE.Vector2((point.lng - refLng) * scale * Math.cos(refLat * DEG), (point.lat - refLat) * scale),
      );
      const first = points[0];
      const last = points[points.length - 1];
      if (first && last && !first.equals(last)) points.push(first);
      let height = Number.parseFloat(building.tags?.height || "");
      const levels = Number.parseFloat(building.tags?.["building:levels"] || "");
      if (!Number.isNaN(levels)) height = levels * 2.8;
      if (Number.isNaN(height)) height = 10;
      const id = building.id ?? index;
      let view: BuildingView;
      try {
        view = new BuildingView(
          id,
          new THREE.Shape(points),
          height,
          building.tags || {},
          this.buildingScales.get(id) || { x: 1, y: 1, z: 1 },
          this.buildingPositions.get(id) || { x: 0, y: 0, z: 0 },
          this,
        );
      } catch {
        // A broken OSM outline is skipped rather than allowed to stop the city.
        return;
      }
      view.setSelected(this.selectedBuilding === id);
      this.scene.add(view.group);
      this.byMesh.set(view.mesh, view);
      this.buildings.push(view);
    });
    for (const view of this.views) view.renderReadout();
  }

  private scheduleRoads(): void {
    window.clearTimeout(this.roadsTimer);
    this.roadsAbort?.abort();
    this.roadsAbort = null;
    // The original fetched roads for every intermediate box while one was being
    // drawn; waiting for the pointer to rest asks once instead.
    this.roadsTimer = window.setTimeout(() => {
      const [north, south] = this.center;
      if (!north || !south) return;
      const controller = new AbortController();
      this.roadsAbort = controller;
      // The floor ring is wider than the drawn box (its circumscribed circle), so roads are
      // asked for the ring's whole square: otherwise they stop at the box and the city looks framed.
      const { refLat, refLng, radius } = this.reference();
      const reach = radius * 2;
      const dLat = reach / scale;
      const dLng = reach / (scale * Math.max(Math.cos(refLat * DEG), 0.01));
      const query = `[out:json][timeout:25];(way["highway"](${refLat - dLat},${refLng - dLng},${refLat + dLat},${refLng + dLng}););out body geom;`;
      queryOverpass(query, controller.signal)
        .then((data) => {
          this.roads = data.elements || [];
          this.rebuildRoads();
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          this.roads = [];
          this.rebuildRoads();
        });
    }, 300);
  }

  private rebuildRoads(): void {
    disposeTree(this.roadsGroup);
    this.roadsGroup.clear();
    const { refLat, refLng } = this.reference();
    const project = (lat: number, lng: number) =>
      new THREE.Vector3((lng - refLng) * scale * Math.cos(refLat * DEG), 0.14, -(lat - refLat) * scale);
    for (const road of this.roads) {
      if (!road.geometry || road.geometry.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(road.geometry.map((point) => project(point.lat, point.lon))),
        new THREE.LineBasicMaterial({ color: cHex(36, 205, 228), transparent: true, opacity: 0.55 }),
      );
      this.roadsGroup.add(line);
    }
  }

  private rebuildPlatform(): void {
    for (const group of [this.floor?.group, this.atmosphere]) {
      if (!group) continue;
      group.removeFromParent();
      disposeTree(group);
    }
    this.floor = null;
    this.atmosphere = null;
    if (!this.showPlatform) return;

    const radius = this.radius;
    const basic = (r: number, g: number, b: number, opacity: number) =>
      new THREE.MeshBasicMaterial({ color: cHex(r, g, b), transparent: true, opacity, side: THREE.DoubleSide });

    // HoloFloor
    const floor = new THREE.Group();
    floor.rotation.x = -Math.PI / 2;
    for (const fraction of [0.28, 0.48, 0.7, 0.93]) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * fraction - 0.018, radius * fraction + 0.018, 96),
        basic(72, 245, 255, 0.38),
      );
      ring.position.z = 0.005;
      floor.add(ring);
    }
    const scan = new THREE.Mesh(new THREE.RingGeometry(radius * 0.94, radius, 96), basic(111, 250, 255, 0.26));
    scan.position.z = 0.02;
    floor.add(scan);
    this.scene.add(floor);
    this.floor = { group: floor, scan };

    // HoloAtmosphere
    const atmosphere = new THREE.Group();
    const outer = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.62, 0.025, 8, 80),
      new THREE.MeshBasicMaterial({ color: cHex(83, 246, 255), transparent: true, opacity: 0.65 }),
    );
    outer.rotation.set(Math.PI / 2, 0, 0);
    const inner = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 0.43, 0.018, 8, 80),
      new THREE.MeshBasicMaterial({ color: cHex(25, 126, 153), transparent: true, opacity: 0.55 }),
    );
    inner.rotation.set(Math.PI / 2, 0.65, 0);
    inner.position.y = 7;
    const light = new THREE.PointLight(cHex(44, 234, 255), 24, radius * 2.4);
    light.position.y = 15;
    atmosphere.add(outer, inner, light);
    this.scene.add(atmosphere);
    this.atmosphere = atmosphere;
  }

  private readonly labelPoint = new THREE.Vector3();
  private readonly viewPoint = new THREE.Vector3();

  /** drei's `<Html center distanceFactor={12}>`: a DOM label pinned to a 3D point. */
  private placeLabels(width: number, height: number): LabelPlacement[] {
    const placements: LabelPlacement[] = [];
    const scaleFov = 2 * Math.tan((this.camera.fov * DEG) / 2);
    for (const building of this.buildings) {
      if (!building.labelVisible) continue;
      const point = building.labelAnchor(this.labelPoint);
      if (this.viewPoint.copy(point).applyMatrix4(this.camera.matrixWorldInverse).z > 0) continue;
      const distance = point.distanceTo(this.camera.position);
      point.project(this.camera);
      const x = (point.x * 0.5 + 0.5) * width;
      const y = (-point.y * 0.5 + 0.5) * height;
      placements.push({
        id: building.id,
        transform: `translate3d(${x}px, ${y}px, 0) scale(${12 / (scaleFov * distance)})`,
        zIndex: String(Math.max(0, 16777271 - Math.round(distance * 100))),
        text: building.labelText(),
      });
    }
    return placements;
  }

  private readonly tick = (): void => {
    const [first] = this.views;
    if (!first) return;
    const { width, height } = first.size();
    if (width === 0 || height === 0) return;

    const elapsed = (performance.now() - this.startedAt) / 1000;
    for (const view of this.views) view.controls.update();
    if (this.floor) {
      const progress = (elapsed * 0.13) % 1;
      this.floor.scan.scale.setScalar(0.18 + progress * 0.82);
      this.floor.scan.material.opacity = (1 - progress) * 0.5;
    }
    if (this.atmosphere) this.atmosphere.rotation.y = elapsed * 0.035;

    const buffer = this.renderer.getSize(new THREE.Vector2());
    if (buffer.x !== width || buffer.y !== height) {
      this.renderer.setSize(width, height, false);
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
    const labels = this.placeLabels(width, height);
    this.renderer.render(this.scene, this.camera);
    // Copied in the same task as the render, while the drawing buffer is valid.
    this.mirror.present();
    for (const view of this.views) view.placeLabels(labels);
  };
}

type LabelNodes = { anchor: HTMLDivElement; lines: [HTMLElement, HTMLElement, HTMLElement] };

/**
 * One eye's copy of the 3D stage: readouts, the frame copied from `SpaceCore`,
 * labels where the core placed them, and orbit controls that all turn the one
 * shared camera. Pointer events go to the core, which owns every decision.
 */
export class SpaceView {
  readonly root: HTMLDivElement;
  readonly canvas: HTMLCanvasElement;
  readonly controls: OrbitControls;

  private readonly wrap: HTMLDivElement;
  private readonly detachCanvas: () => void;
  private readonly labels = new Map<number, LabelNodes>();

  constructor(
    private readonly core: SpaceCore,
    private readonly words: Words,
  ) {
    const vignette = h("div", "holo-vignette");
    const copy = core.mirror.attach();
    this.canvas = copy.canvas;
    this.detachCanvas = copy.detach;
    this.wrap = h("div", "holo-canvas", this.canvas);
    this.root = h("div", "hologram-stage", vignette, this.wrap);
    words.bind(() => this.renderReadout());

    // Registered before the orbit controls: a press on a building has to switch
    // them off before they see the same press, as in the original.
    this.wrap.addEventListener("pointerdown", this.onDown);
    this.wrap.addEventListener("pointermove", this.onMove);
    this.wrap.addEventListener("pointerup", this.onUp);
    this.wrap.addEventListener("pointercancel", this.onUp);
    this.wrap.addEventListener("pointerleave", this.onLeave);
    this.wrap.addEventListener("click", this.onClick);
    this.wrap.addEventListener("twohand", this.onTwoHand);
    this.controls = new OrbitControls(core.camera, this.wrap);
    // The hand is a pointer the orbit controls cannot hold (it cannot be captured), so the
    // hand's events are worked here, first, and kept from reaching them.
    this.wrap.setAttribute("data-hand-target", "");
  }

  size(): { width: number; height: number } {
    return { width: this.wrap.clientWidth, height: this.wrap.clientHeight };
  }

  renderReadout(): void {
    // No readout is drawn any more: the 3D view carries the picture and the tools, nothing else.
  }

  capture(pointerId: number): void {
    try {
      this.wrap.setPointerCapture(pointerId);
    } catch {
      // The pointer is already gone; routing through the core still holds.
    }
  }

  release(pointerId: number): void {
    if (this.wrap.hasPointerCapture?.(pointerId)) this.wrap.releasePointerCapture(pointerId);
  }

  /** Puts the labels where the core placed them for this frame. */
  placeLabels(placements: readonly LabelPlacement[]): void {
    const shown = new Set<number>();
    for (const placement of placements) {
      shown.add(placement.id);
      const nodes = this.labelFor(placement.id);
      nodes.anchor.style.display = "";
      nodes.anchor.style.transform = placement.transform;
      nodes.anchor.style.zIndex = placement.zIndex;
      placement.text.forEach((line, index) => {
        const node = nodes.lines[index];
        if (node && node.textContent !== line) node.textContent = line;
      });
    }
    for (const [id, nodes] of this.labels) if (!shown.has(id)) nodes.anchor.style.display = "none";
  }

  dispose(): void {
    this.detachCanvas();
    this.controls.dispose();
    this.wrap.removeEventListener("pointerdown", this.onDown);
    this.wrap.removeEventListener("pointermove", this.onMove);
    this.wrap.removeEventListener("twohand", this.onTwoHand);
    this.wrap.removeEventListener("pointerup", this.onUp);
    this.wrap.removeEventListener("pointercancel", this.onUp);
    this.wrap.removeEventListener("pointerleave", this.onLeave);
    this.wrap.removeEventListener("click", this.onClick);
    this.root.remove();
  }

  private labelFor(id: number): LabelNodes {
    const existing = this.labels.get(id);
    if (existing) return existing;
    const lines: [HTMLElement, HTMLElement, HTMLElement] = [h("span"), h("strong"), h("small")];
    const anchor = h("div", "holo-label-anchor", h("div", "holo-building-label", ...lines));
    this.wrap.append(anchor);
    const nodes = { anchor, lines };
    this.labels.set(id, nodes);
    return nodes;
  }

  private readonly onDown = (event: PointerEvent) => {
    if (isHandPointerId(event.pointerId)) {
      event.stopImmediatePropagation();
      this.core.handDown(event, this);
      return;
    }
    this.core.pointerDown(event, this);
  };
  private readonly onMove = (event: PointerEvent) => {
    if (isHandPointerId(event.pointerId)) {
      event.stopImmediatePropagation();
      this.core.handMove(event);
      return;
    }
    this.core.pointerMove(event, this);
  };
  private readonly onUp = (event: PointerEvent) => {
    if (isHandPointerId(event.pointerId)) {
      event.stopImmediatePropagation();
      this.core.handUp(event);
      return;
    }
    this.core.pointerUp(event, this);
  };
  private readonly onTwoHand = (event: Event) => {
    // Taken here, so Core does not also send it on as a mouse wheel and zoom twice.
    event.preventDefault();
    this.core.twoHand((event as CustomEvent<TwoHandDomDetail>).detail, this);
  };
  private readonly onLeave = () => this.core.pointerLeave();
  private readonly onClick = (event: MouseEvent) => this.core.click(event, this);
}

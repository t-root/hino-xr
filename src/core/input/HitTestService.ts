import * as THREE from "three";
import type { HitResult, InteractiveTargetKind } from "@/shared/contracts/input";
import type { NormalizedPoint } from "@/shared/contracts/vision";
import type { CoordinateMapper } from "../rendering/CoordinateMapper";
import type { InteractiveRegistry } from "./InteractiveRegistry";

const PRIORITY: Record<InteractiveTargetKind, number> = { palette: 0, ui: 1, detection: 2 };

/**
 * Resolves a pointer to a target using the cyclops camera. Hit-testing per eye
 * would let the two views disagree about what is focused, so it is done once
 * from the head centre.
 */
export class HitTestService {
  private readonly raycaster = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(
    private readonly registry: InteractiveRegistry,
    private readonly camera: THREE.Camera,
    private readonly mapper: CoordinateMapper,
  ) {}

  /** `point` is in normalised image space; mirror/rotation are applied here. */
  hit(point: NormalizedPoint): HitResult | null {
    const targets = this.registry.pickables();
    if (targets.length === 0) return null;

    const display = this.mapper.imageToDisplay(point);
    const ndc = this.mapper.displayToNdc(display);
    this.ndc.set(ndc.x, ndc.y);
    this.raycaster.setFromCamera(this.ndc, this.camera);

    const byUuid = new Map(targets.map((target) => [target.object.uuid, target]));
    const intersections = this.raycaster.intersectObjects(
      targets.map((target) => target.object),
      false,
    );

    let best: HitResult | null = null;
    let bestPriority = Number.POSITIVE_INFINITY;
    for (const intersection of intersections) {
      const target = byUuid.get(intersection.object.uuid);
      if (!target) continue;
      const priority = PRIORITY[target.kind];
      if (priority > bestPriority) continue;
      if (best && priority === bestPriority && intersection.distance >= best.distance) continue;
      bestPriority = priority;
      best = {
        targetId: target.id,
        kind: target.kind,
        point: display,
        distance: intersection.distance,
      };
    }
    return best;
  }
}

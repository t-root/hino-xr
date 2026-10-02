import type * as THREE from "three";
import type { GestureEvent, InteractiveTargetKind } from "@/shared/contracts/input";

type InteractionCallback = (event: GestureEvent) => void;

type InteractiveTarget = {
  readonly id: string;
  readonly kind: InteractiveTargetKind;
  /** Mesh used for ray intersection. Must be `visible` to be pickable. */
  readonly object: THREE.Object3D;
  enabled: boolean;
  draggable: boolean;
  onEvent?: InteractionCallback;
};

/**
 * Every hand-interactive thing registers here: UI panels, palette cards and
 * selectable detections. Hit-testing has one list, so priority rules stay in
 * one place instead of being duplicated per feature.
 */
export class InteractiveRegistry {
  private readonly targets = new Map<string, InteractiveTarget>();

  register(target: InteractiveTarget): () => void {
    target.object.userData.targetId = target.id;
    this.targets.set(target.id, target);
    return () => this.unregister(target.id);
  }

  unregister(id: string): void {
    this.targets.delete(id);
  }

  get(id: string): InteractiveTarget | undefined {
    return this.targets.get(id);
  }

  /** Objects eligible for picking, ordered so UI wins over detections. */
  pickables(): readonly InteractiveTarget[] {
    const priority: Record<InteractiveTargetKind, number> = { palette: 0, ui: 1, detection: 2 };
    return [...this.targets.values()]
      .filter((target) => target.enabled && target.object.visible)
      .sort((a, b) => priority[a.kind] - priority[b.kind]);
  }

  clear(): void {
    this.targets.clear();
  }
}

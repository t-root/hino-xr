import type { Locale } from "@/shared/contracts/locale";
import type { DetectionBatch, FramePacket, ModuleManifest } from "@/shared/contracts/vision";

type ModuleLogger = Readonly<{
  debug(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}>;

type ModuleMetrics = Readonly<{
  timing(name: string, ms: number): void;
  count(name: string, value?: number): void;
}>;

/** Draws one copy of a plugin's screen into `element`; returns how to take it down. */
export type ModuleScreenView = (element: HTMLElement) => () => void;

/**
 * A screen of its own, for a plugin that is an application rather than a
 * detector: a map, an editor, anything driven by mouse and touch.
 *
 * Handed over only to a plugin whose manifest asks for `screen` and that has
 * been granted it in `permissions.ts`. Like the rest of the interface it is
 * drawn once per eye, inside each camera frame, above the menu (rules.md):
 * `view` is called with an empty element in every eye, now and again whenever
 * the eyes are rebuilt, so every copy must be drawn from one shared state and
 * anything with its own clock (a canvas, an animation) drawn once and copied.
 * Core shows the copies while the plugin is on, hides them when it is switched
 * off, and takes them down with the plugin.
 */
export interface ModuleScreen {
  show(view: ModuleScreenView): void;
  /** Switches the plugin off, exactly as its switch in the menu would. */
  close(): void;
}

/**
 * Everything a module is allowed to touch. There is deliberately no camera, no
 * DOM node, no renderer and no event bus here: a module receives frames and
 * returns normalised results, nothing else — unless it was granted `screen`,
 * in which case `screen` is the one element it may fill.
 */
export interface ModuleContext {
  readonly logger: ModuleLogger;
  readonly metrics: ModuleMetrics;
  readonly config: Readonly<Record<string, unknown>>;
  /**
   * The language the interface is in, read per frame rather than handed over
   * once: a module is initialised long before someone changes the setting, and
   * the label on a box has to change with everything else on screen.
   */
  locale(): Locale;
  /** Present only for a plugin that asked for and was granted `screen`. */
  readonly screen: ModuleScreen | null;
}

export interface VisionModule {
  readonly manifest: ModuleManifest;
  initialize(context: ModuleContext): Promise<void>;
  /** Must honour `signal`: the manager aborts inference that outlives its frame. */
  process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch>;
  setEnabled(enabled: boolean): Promise<void>;
  dispose(): Promise<void>;
}

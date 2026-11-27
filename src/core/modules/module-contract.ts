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

export type ModuleScreenView = (element: HTMLElement) => () => void;

export interface ModuleScreen {
  show(view: ModuleScreenView): void;
  close(): void;
}

export interface ModuleContext {
  readonly logger: ModuleLogger;
  readonly metrics: ModuleMetrics;
  readonly config: Readonly<Record<string, unknown>>;
  locale(): Locale;
  readonly screen: ModuleScreen | null;
}

export type CommandReply = string | Readonly<{ say: string; show: string }>;

export interface VisionModule {
  readonly manifest: ModuleManifest;
  initialize(context: ModuleContext): Promise<void>;
  process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch>;
  setEnabled(enabled: boolean): Promise<void>;
  command?(name: string, payload: Readonly<Record<string, unknown>>): Promise<CommandReply | null>;
  dispose(): Promise<void>;
}

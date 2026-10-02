import type { ModuleScreen, ModuleScreenView } from "./module-contract";

/** A plugin's screen plus the handle Core keeps to show, hide and remove it. */
export type ModuleScreenHandle = Readonly<{
  screen: ModuleScreen;
  setVisible: (visible: boolean) => void;
  dispose: () => void;
}>;

export type ModuleScreenFactory = (moduleId: string) => ModuleScreenHandle;

type Copy = { element: HTMLElement; stop: () => void };

type Entry = {
  id: string;
  view: ModuleScreenView | null;
  visible: boolean;
  /** One copy per eye, keyed by that eye's camera frame. */
  copies: Map<HTMLElement, Copy>;
};

/**
 * Puts plugin screens where the rest of the interface lives: one copy in every
 * eye's camera frame (rules.md). The eyes are rebuilt when the layout
 * changes, so frames come and go independently of plugins; whichever side
 * arrives second is mounted into what the other already has.
 */
export class ModuleScreenHost {
  private readonly frames = new Set<HTMLElement>();
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly close: (moduleId: string) => void,
    /** A screen just appeared: whatever it covers should get out of the way. */
    private readonly onShown: () => void = () => {},
    /**
     * A plugin's drawing code threw. It runs inside Core's own mount of each
     * eye, so it is caught here and reported instead of taking the eye down.
     */
    private readonly onError: (moduleId: string, error: unknown) => void = () => {},
  ) {}

  /** Called for every eye's camera frame; the returned function forgets it. */
  mountFrame(frame: HTMLElement): () => void {
    this.frames.add(frame);
    for (const entry of this.entries.values()) this.mount(entry, frame);
    return () => {
      for (const entry of this.entries.values()) this.unmount(entry, frame);
      this.frames.delete(frame);
    };
  }

  create(moduleId: string): ModuleScreenHandle {
    const entry: Entry = { id: moduleId, view: null, visible: false, copies: new Map() };
    this.entries.set(moduleId, entry);

    const screen: ModuleScreen = {
      show: (view) => {
        for (const frame of [...entry.copies.keys()]) this.unmount(entry, frame);
        entry.view = view;
        for (const frame of this.frames) this.mount(entry, frame);
        if (entry.visible) this.onShown();
      },
      close: () => this.close(moduleId),
    };

    return {
      screen,
      setVisible: (visible) => {
        const appeared = visible && !entry.visible;
        entry.visible = visible;
        for (const copy of entry.copies.values()) copy.element.hidden = !visible;
        if (appeared && entry.view) this.onShown();
      },
      dispose: () => {
        for (const frame of [...entry.copies.keys()]) this.unmount(entry, frame);
        entry.view = null;
        this.entries.delete(moduleId);
      },
    };
  }

  private mount(entry: Entry, frame: HTMLElement): void {
    if (!entry.view || entry.copies.has(frame)) return;
    const element = frame.ownerDocument.createElement("div");
    element.className = "module-screen";
    element.hidden = !entry.visible;
    frame.append(element);
    try {
      entry.copies.set(frame, { element, stop: entry.view(element) });
    } catch (error) {
      element.remove();
      this.onError(entry.id, error);
    }
  }

  private unmount(entry: Entry, frame: HTMLElement): void {
    const copy = entry.copies.get(frame);
    if (!copy) return;
    entry.copies.delete(frame);
    try {
      copy.stop();
    } catch (error) {
      this.onError(entry.id, error);
    }
    copy.element.remove();
  }
}

import type { ModuleScreen, ModuleScreenView } from "./module-contract";

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
  copies: Map<HTMLElement, Copy>;
};

export class ModuleScreenHost {
  private readonly frames = new Set<HTMLElement>();
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly close: (moduleId: string) => void,
    private readonly onShown: () => void = () => {},
    private readonly onError: (moduleId: string, error: unknown) => void = () => {},
  ) {}

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

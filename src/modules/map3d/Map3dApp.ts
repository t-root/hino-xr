import { SharedState } from "@/core/sync";
import { queryOverpass } from "./overpass";
import { MapModel, type LatLng, type MapView } from "./SelectMap";
import { SpaceCore, type Building, type SpaceView } from "./Space";
import { map3dCss } from "./styles";
import { h, icon, MODAL_CLOSE_DELAY_MS, MODAL_CLOSED, ModalView, show, type ModalState, type Words } from "./ui";

const PRETENDARD = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css";

type ModalKey = "warn" | "export";

/** What every copy of the screen shows. */
type AppState = Readonly<{
  step: number;
  isNextButtonDisabled: boolean;
  isFetchingBuildings: boolean;
  modals: Readonly<Record<ModalKey, ModalState>>;
}>;

/**
 * The original `App.tsx`: pick an area on the map, go to the next step to load
 * its buildings into the 3D stage, go back to pick again, export what is shown.
 *
 * Held once, in a Core `SharedState`. Every eye mounts an `AppView` that draws
 * from it and sends its clicks back here, so both copies always show the same
 * step, the same buttons and the same open modal (rules.md).
 */
export class Map3dApp {
  readonly map: MapModel;
  readonly space: SpaceCore;

  readonly state = new SharedState<AppState>({
    step: 0,
    isNextButtonDisabled: true,
    isFetchingBuildings: false,
    modals: { warn: MODAL_CLOSED, export: MODAL_CLOSED },
  });

  /** The chosen area; not drawn by the copies, only used to load it. */
  private areaData: [LatLng, LatLng] | null = null;
  private readonly views = new Set<AppView>();
  private readonly modalTimers: Record<ModalKey, number> = { warn: 0, export: 0 };
  private active = false;
  private disposed = false;

  constructor(
    private readonly words: Words,
    readonly close: () => void,
  ) {
    this.map = new MapModel(words, {
      onDone: (data) => this.handleDone(data),
      onRemove: () => this.handleRemove(),
    });
    this.space = new SpaceCore(words);
  }

  /** Draws one copy into `element` (one eye); returns how to take it down. */
  mount(element: HTMLElement): () => void {
    const view = new AppView(this, this.words.scope());
    this.views.add(view);
    element.append(view.root);
    if (this.active) view.activate();
    return () => {
      this.views.delete(view);
      view.dispose();
    };
  }

  /** The screen was shown or hidden by Core. */
  setActive(active: boolean): void {
    this.active = active;
    this.space.setRunning(active);
    if (!active) return;
    this.words.refresh();
    for (const view of this.views) view.activate();
  }

  /** The theme moved while the screen was away: recolour everything. */
  applyPalette(): void {
    for (const view of this.views) view.restyle();
    this.map.state.notify();
    this.space.applyPalette();
  }

  dispose(): void {
    this.disposed = true;
    for (const key of Object.keys(this.modalTimers) as ModalKey[]) window.clearTimeout(this.modalTimers[key]);
    for (const view of [...this.views]) view.dispose();
    this.views.clear();
    this.map.dispose();
    this.space.dispose();
  }

  /** Every change to what is shown goes through here, then to every copy. */
  private update(patch: Partial<AppState>): void {
    this.state.set(patch);
    this.space.setShowPlatform(this.state.get().step === 2);
  }

  private setModal(key: ModalKey, modal: ModalState): void {
    this.update({ modals: { ...this.state.get().modals, [key]: modal } });
  }

  // ---- what the copies ask for ----

  setStep(step: number): void {
    this.update({ step });
  }

  openModal(key: ModalKey): void {
    window.clearTimeout(this.modalTimers[key]);
    this.setModal(key, { open: true, closing: false });
  }

  /** Plays the fade out on every copy, then hides, as the original did. */
  closeModal(key: ModalKey): void {
    if (!this.state.get().modals[key].open) return;
    window.clearTimeout(this.modalTimers[key]);
    this.setModal(key, { open: true, closing: true });
    this.modalTimers[key] = window.setTimeout(() => this.setModal(key, MODAL_CLOSED), MODAL_CLOSE_DELAY_MS);
  }

  proceedFromWarning(): void {
    this.closeModal("warn");
    void this.startBuildingLoad();
  }

  async handleClickNextStep(): Promise<void> {
    const { step } = this.state.get();
    if (step === 0 && this.areaData && this.checkIsBig(this.areaData)) {
      this.openModal("warn");
      return;
    }
    if (step === 0) {
      await this.startBuildingLoad();
      return;
    }
    this.setStep(step + 1);
  }

  // ---- the original logic ----

  private checkIsBig(area: [LatLng, LatLng]): boolean {
    const a = area[0].lat - area[1].lat;
    const b = area[0].lng - area[1].lng;
    return a + b > 0.1;
  }

  private handleDone(data: [LatLng, LatLng]): void {
    this.areaData = data;
    this.space.setCenter(data);
    // The original kept the previous city on screen until the next load; it
    // was drawn against the new centre, in the wrong place. Cleared instead.
    this.space.setAreas([]);
    this.update({ isNextButtonDisabled: false });
  }

  private handleRemove(): void {
    this.areaData = null;
    this.space.setAreas([]);
    this.update({ isNextButtonDisabled: true });
  }

  private async requestBuildings(): Promise<boolean> {
    const selectedArea = this.areaData;
    if (!selectedArea) return false;
    this.update({ isFetchingBuildings: true });

    const south = selectedArea[1].lat;
    const west = selectedArea[1].lng;
    const north = selectedArea[0].lat;
    const east = selectedArea[0].lng;
    const query = `[out:json][timeout:25];(way["building"]( ${south},${west},${north},${east} );relation["building"]( ${south},${west},${north},${east} ););out body geom;`;
    try {
      const data = await queryOverpass(query);
      if (this.disposed) return false;
      const blds: Building[] = data.elements.map((element) => ({
        id: element.id,
        tags: element.tags ?? {},
        ...(element.geometry ? { geometry: element.geometry.map((pt) => ({ lat: pt.lat, lng: pt.lon })) } : {}),
      }));
      this.space.setAreas(blds);
      return true;
    } catch (error) {
      console.error("Error fetching building data:", error);
      return false;
    } finally {
      if (!this.disposed) this.update({ isFetchingBuildings: false });
    }
  }

  private async startBuildingLoad(): Promise<void> {
    this.update({ isNextButtonDisabled: true, step: 2 });
    const loaded = await this.requestBuildings();
    if (!loaded && !this.disposed) this.update({ isNextButtonDisabled: false, step: 0 });
  }
}

/** One eye's copy of the whole screen. Holds no state of its own. */
class AppView {
  readonly root: HTMLDivElement;

  private readonly style: HTMLStyleElement;
  private readonly mapView: MapView;
  private readonly spaceView: SpaceView;
  private readonly fullscreen: HTMLDivElement;
  private readonly prevButton: HTMLButtonElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly exportButton: HTMLButtonElement;
  private readonly warnNextButton: HTMLButtonElement;
  private readonly warnModal: ModalView;
  private readonly exportModal: ModalView;
  private readonly stopState: () => void;

  constructor(
    private readonly app: Map3dApp,
    private readonly words: Words,
  ) {
    this.style = h("style");
    this.style.textContent = map3dCss();
    const font = h("link");
    font.rel = "stylesheet";
    font.href = PRETENDARD;

    this.mapView = app.map.createView(words);
    this.fullscreen = h("div", "m3-fullscreen", h("div", "m3-fullscreen__inner", this.mapView.root));

    this.prevButton = h("button", "m3-prev", icon("chevronLeft"), " ", words.node("prevStep"));
    this.prevButton.addEventListener("click", () => app.setStep(0));

    this.nextButton = h("button", "m3-next", words.node("nextStep"), " ", icon("chevronRight"));
    this.nextButton.addEventListener("click", () => void app.handleClickNextStep());

    this.exportButton = h("button", "m3-next", words.node("exportGlb"), " ", icon("download"));
    this.exportButton.addEventListener("click", () => app.openModal("export"));

    this.warnNextButton = h("button", "m3-button", words.node("nextStep"), " ", icon("chevronRight"));
    this.warnNextButton.addEventListener("click", () => app.proceedFromWarning());
    this.warnModal = new ModalView(
      [
        h(
          "div",
          "m3-column",
          h("p", "m3-title", words.node("tooBig")),
          h("p", "m3-description", words.node("proceed")),
          this.warnNextButton,
        ),
      ],
      () => app.closeModal("warn"),
    );

    const download = h("button", "m3-button", words.node("glbDownload"), " ", icon("download"));
    download.addEventListener("click", () => app.space.exportGlb());
    this.exportModal = new ModalView(
      [h("div", "m3-column", h("p", "m3-title", words.node("export")), h("div", "m3-row", download))],
      () => app.closeModal("export"),
    );

    const closeButton = h("button", "m3-close", words.node("close"));
    closeButton.addEventListener("click", () => app.close());

    this.spaceView = app.space.createView(words);
    this.root = h(
      "div",
      "map3d app-shell",
      this.style,
      font,
      this.fullscreen,
      this.prevButton,
      this.nextButton,
      this.exportButton,
      this.warnModal.root,
      this.exportModal.root,
      this.spaceView.root,
      closeButton,
    );
    this.stopState = app.state.subscribe((state) => this.render(state));
  }

  private render(state: AppState): void {
    const wasHidden = this.fullscreen.hidden;
    this.fullscreen.hidden = state.step !== 0;
    if (wasHidden && !this.fullscreen.hidden) this.mapView.invalidate();

    show(this.prevButton, state.step !== 0);
    show(this.nextButton, state.step !== 2);
    this.nextButton.disabled = state.isNextButtonDisabled || state.isFetchingBuildings;
    show(this.exportButton, state.step === 2 && !state.isFetchingBuildings);
    show(this.warnNextButton, state.step !== 2);
    this.warnNextButton.disabled = state.isNextButtonDisabled;
    this.warnModal.render(state.modals.warn);
    this.exportModal.render(state.modals.export);
  }

  /** Became visible: Leaflet measures again and the readouts catch up. */
  activate(): void {
    this.mapView.invalidate();
    this.spaceView.renderReadout();
  }

  restyle(): void {
    this.style.textContent = map3dCss();
  }

  dispose(): void {
    this.stopState();
    this.app.map.dropView(this.mapView);
    this.app.space.dropView(this.spaceView);
    this.words.dispose();
    this.root.remove();
  }
}

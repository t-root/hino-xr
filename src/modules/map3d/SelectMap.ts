// Leaflet is this plugin's own dependency: pinned in ./vendor.json, unpacked
// into ./vendor by Python. It ships no types.
// @ts-ignore
import * as L from "./vendor/leaflet/dist/leaflet-src.esm.js";
import "./vendor/leaflet/dist/leaflet.css";
import { CanvasMirror, CopySync, SharedState } from "@/core/sync";
import { c } from "./palette";
import { h, icon, show, type Words } from "./ui";

/** The few Leaflet shapes the plugin touches. */
export type LatLng = { lat: number; lng: number };
type LeafletLatLng = LatLng & { equals?(other: LatLng): boolean };
type LeafletBounds = { _northEast: LatLng; _southWest: LatLng };
type MapEvent = { latlng: LeafletLatLng };

/**
 * One download per tile, drawn into every eye at once.
 *
 * Leaflet's own tiles are `<img>` elements, one per map, each loading and
 * decoding on its own and so appearing a frame apart in the two eyes (rules.md).
 * Here a tile is fetched once into a Core `CanvasMirror`; every map that shows
 * it holds one of the mirror's canvases, and all are painted in the same call.
 */
const tileImages = new Map<string, Promise<HTMLImageElement>>();
const tileMirrors = new Map<string, CanvasMirror>();
const tileCopies = new WeakMap<HTMLElement, { url: string; detach: () => void }>();

const loadTile = (url: string): Promise<HTMLImageElement> => {
  let pending = tileImages.get(url);
  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => {
        tileImages.delete(url);
        reject(new Error(`tile failed: ${url}`));
      };
      image.src = url;
    });
    tileImages.set(url, pending);
    // A city's worth of tiles is plenty to keep; older ones are fetched again.
    if (tileImages.size > 512) tileImages.delete(tileImages.keys().next().value as string);
  }
  return pending;
};

const SharedTileLayer = L.TileLayer.extend({
  onAdd(map: unknown) {
    L.TileLayer.prototype.onAdd.call(this, map);
    this.on("tileunload", ({ tile }: { tile: HTMLElement }) => {
      const copy = tileCopies.get(tile);
      if (!copy) return;
      copy.detach();
      const mirror = tileMirrors.get(copy.url);
      if (mirror && mirror.copies === 0) tileMirrors.delete(copy.url);
    });
  },
  createTile(coords: unknown, done: (error: Error | null, tile: HTMLElement) => void) {
    const url: string = this.getTileUrl(coords);
    let mirror = tileMirrors.get(url);
    if (!mirror) {
      mirror = new CanvasMirror();
      tileMirrors.set(url, mirror);
    }
    const copy = mirror.attach();
    tileCopies.set(copy.canvas, { url, detach: copy.detach });
    const shared = mirror;
    loadTile(url).then(
      (image) => {
        shared.setSource(image);
        shared.present();
        done(null, copy.canvas);
      },
      (error: Error) => done(error, copy.canvas),
    );
    return copy.canvas;
  },
});

/** Wraps longitude into -180..180, as the original did before reporting an area. */
const adjustLng = (latlng: LatLng): LeafletLatLng => {
  const adjustedLng = ((((latlng.lng + 180) % 360) + 360) % 360) - 180;
  return new L.LatLng(latlng.lat, adjustedLng);
};

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors';
const BEACON_HTML = '<span class="holo-location-beacon"></span>';

type SelectMapOptions = Readonly<{
  /** `[northEast, southWest]` of the box being drawn or just drawn. */
  onDone: (area: [LatLng, LatLng]) => void;
  onRemove: () => void;
}>;

/** What every copy of the map step shows. */
type MapState = Readonly<{
  isDrag: boolean;
  bounds: LeafletBounds | null;
  drawBounds: LeafletBounds | null;
  locating: boolean;
  locationError: string;
  userLocation: [number, number] | null;
}>;

/**
 * Where a map looks. `anchor` is what the moved map has at its top-left
 * corner: Leaflet rounds where it puts the map when given only a centre, so a
 * copy set from the centre alone can sit a pixel off the one being dragged.
 */
type MapViewState = Readonly<{ center: LatLng; zoom: number; anchor?: LatLng }>;

/**
 * The first step of the original — "Select Box" turns dragging into drawing a
 * rectangle, "Remove Box" clears it, "My Location" flies to the device — held
 * once for every copy of the screen, through Core's sync tools:
 *
 * - what the copies show is a `SharedState`;
 * - where each Leaflet map looks is a `CopySync`: the map the wearer moves
 *   publishes its view and the others are moved to it in the same task.
 *
 * Leaflet's zoom and fade animations run on clocks of their own, so they are
 * off; tiles come from `SharedTileLayer` above.
 */
export class MapModel {
  readonly state = new SharedState<MapState>({
    isDrag: true,
    bounds: null,
    drawBounds: null,
    locating: false,
    locationError: "",
    userLocation: null,
  });
  readonly view = new CopySync<MapViewState>({ center: { lat: 40.8, lng: -73.95 }, zoom: 13 });

  // A drag in progress is not drawn, only remembered between pointer events.
  private firstPoint: LeafletLatLng | null = null;
  private lastLatlng: LeafletLatLng | null = null;
  private readonly views = new Set<MapView>();
  private disposed = false;

  constructor(
    private readonly words: Words,
    private readonly options: SelectMapOptions,
  ) {}

  createView(words: Words): MapView {
    const view = new MapView(this, words);
    this.views.add(view);
    return view;
  }

  dropView(view: MapView): void {
    this.views.delete(view);
    view.dispose();
  }

  invalidate(): void {
    for (const view of this.views) view.invalidate();
  }

  dispose(): void {
    this.disposed = true;
    for (const view of [...this.views]) this.dropView(view);
  }

  // ---- drawing, as in RectangleSelector ----

  mouseDown(latlng: LeafletLatLng): void {
    if (!this.state.get().isDrag) this.firstPoint = latlng;
  }

  mouseMove(latlng: LeafletLatLng): void {
    if (!this.firstPoint) return;
    this.lastLatlng = adjustLng(latlng);
    this.handleChangeDraw(new L.LatLngBounds(this.firstPoint, latlng));
  }

  mouseUp(latlng: LeafletLatLng): void {
    if (!this.firstPoint) return;
    this.handleChangeDraw(new L.LatLngBounds(this.firstPoint, latlng));
    this.handleChangeDone(new L.LatLngBounds(adjustLng(this.firstPoint), adjustLng(latlng)));
    this.firstPoint = null;
  }

  touchStart(latlng: LeafletLatLng): void {
    if (!this.state.get().isDrag) this.firstPoint = latlng;
  }

  touchMove(latlng: LeafletLatLng): void {
    if (!this.firstPoint) return;
    this.lastLatlng = latlng;
    this.handleChangeDraw(new L.LatLngBounds(this.firstPoint, latlng));
  }

  touchEnd(): void {
    if (!this.firstPoint) return;
    const latlng = this.lastLatlng || this.firstPoint;
    this.handleChangeDraw(new L.LatLngBounds(this.firstPoint, latlng));
    this.handleChangeDone(new L.LatLngBounds(adjustLng(this.firstPoint), adjustLng(latlng)));
    this.firstPoint = null;
  }

  // ---- buttons ----

  toggleDrag(): void {
    this.state.set({ isDrag: !this.state.get().isDrag });
  }

  removeBox(): void {
    this.options.onRemove();
    this.state.set({ bounds: null, drawBounds: null, isDrag: true });
  }

  requestLocation(): void {
    this.state.set({ locationError: "", locating: true });

    const finish = (error = "") => {
      if (this.disposed) return;
      this.state.set({ locating: false, locationError: error });
    };

    if (!navigator.geolocation) {
      finish(this.words.get("noGeolocation"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (this.disposed) return;
        const position: [number, number] = [coords.latitude, coords.longitude];
        // One map flies; its moves are published, so the rest follow frame by frame.
        const [leader] = this.views;
        if (leader) leader.flyTo(position);
        else this.view.set({ center: { lat: position[0], lng: position[1] }, zoom: 16 });
        this.state.set({ userLocation: position });
        finish();
      },
      () => finish(this.words.get("locationDenied")),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  private handleChangeDone(bounds: LeafletBounds): void {
    this.options.onDone([bounds._northEast, bounds._southWest]);
    this.state.set({ bounds });
  }

  private handleChangeDraw(bounds: LeafletBounds): void {
    this.options.onDone([bounds._northEast, bounds._southWest]);
    this.state.set({ drawBounds: bounds });
  }
}

/** One eye's copy of the map step: the original `MapComponent`. Holds no state. */
export class MapView {
  readonly root: HTMLDivElement;

  private readonly map: any;
  private readonly container: HTMLDivElement;
  private readonly removeButton: HTMLButtonElement;
  private readonly modeButton: HTMLButtonElement;
  private readonly locateButton: HTMLButtonElement;
  private readonly locateLabel: Text;
  private readonly resizeObserver: ResizeObserver;
  private readonly sync: { publish: (view: MapViewState) => void; dispose: () => void };
  private readonly stopState: () => void;
  private rectangle: any = null;
  private marker: any = null;

  constructor(
    private readonly model: MapModel,
    private readonly words: Words,
  ) {
    const caption = h("div", "map-holo-caption", words.node("caption"));
    const credit = h("a", "map-credit", words.node("credit"));
    credit.href = "https://www.openstreetmap.org/copyright";
    credit.target = "_blank";
    credit.rel = "noreferrer";

    this.locateLabel = document.createTextNode("");
    this.locateButton = h("button", "m3-locate", icon("locateFixed"), " ", this.locateLabel);
    this.locateButton.type = "button";
    this.locateButton.addEventListener("click", () => model.requestLocation());

    this.removeButton = h("button", "m3-remove", icon("circleMinus"), " ", words.node("removeBox"));
    this.removeButton.addEventListener("click", () => model.removeBox());

    this.modeButton = h("button", "m3-mode");
    this.modeButton.addEventListener("click", () => model.toggleDrag());

    const tools = h("div", "m3-map__tools", this.locateButton, this.removeButton, this.modeButton);
    this.container = h("div", "m3-map__leaflet hologram-map");
    this.root = h("div", "m3-map", caption, credit, tools, this.container);

    const start = model.view.view;
    this.map = L.map(this.container, {
      center: [start.center.lat, start.center.lng],
      zoom: start.zoom,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      // Leaflet re-measures on window resize after a timer of its own, per map;
      // the observer below re-measures every copy together instead.
      trackResize: false,
    });
    new SharedTileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: OSM_ATTRIBUTION,
    }).addTo(this.map);

    this.sync = model.view.register((view) => this.goTo(view));
    this.map.on("move zoom", () => {
      const center = this.map.getCenter();
      const corner = this.map.containerPointToLatLng([0, 0]);
      this.sync.publish({
        center: { lat: center.lat, lng: center.lng },
        zoom: this.map.getZoom(),
        anchor: { lat: corner.lat, lng: corner.lng },
      });
    });
    this.map.on("mousedown", (event: MapEvent) => model.mouseDown(event.latlng));
    this.map.on("mousemove", (event: MapEvent) => model.mouseMove(event.latlng));
    this.map.on("mouseup", (event: MapEvent) => model.mouseUp(event.latlng));

    this.container.addEventListener("touchstart", this.handleTouchStart);
    this.container.addEventListener("touchmove", this.handleTouchMove);
    this.container.addEventListener("touchend", this.handleTouchEnd);
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(this.container);

    this.stopState = model.state.subscribe((state) => this.render(state));
    words.bind(() => this.render(model.state.get()));
  }

  /** Same view as the copy that moved, to the fraction of a pixel. */
  private goTo(view: MapViewState): void {
    this.map.setView([view.center.lat, view.center.lng], view.zoom, { animate: false });
    if (!view.anchor) return;
    const here = this.map.latLngToContainerPoint([view.anchor.lat, view.anchor.lng]);
    if (here.x === 0 && here.y === 0) return;
    const pane = this.map.getPane("mapPane");
    L.DomUtil.setPosition(pane, L.DomUtil.getPosition(pane).subtract(here));
  }

  flyTo(position: [number, number]): void {
    this.map.flyTo(position, 16, { animate: true, duration: 1.2 });
  }

  /** Leaflet measures its box once; after a resize or being hidden it measures again. */
  invalidate(): void {
    this.map.invalidateSize({ pan: false });
    this.goTo(this.model.view.view);
  }

  dispose(): void {
    this.stopState();
    this.sync.dispose();
    this.resizeObserver.disconnect();
    this.container.removeEventListener("touchstart", this.handleTouchStart);
    this.container.removeEventListener("touchmove", this.handleTouchMove);
    this.container.removeEventListener("touchend", this.handleTouchEnd);
    this.map.remove();
    this.root.remove();
  }

  private render(state: MapState): void {
    this.locateButton.disabled = state.locating;
    this.locateButton.title = state.locationError || this.words.get("locateTitle");
    this.locateLabel.data = this.words.get(state.locating ? "locating" : "myLocation");

    show(this.removeButton, !(state.bounds == null || state.isDrag));

    this.modeButton.dataset.drag = String(state.isDrag);
    this.modeButton.replaceChildren(
      ...(state.isDrag
        ? [icon("mousePointerClick"), h("span", "", this.words.get("selectBox"))]
        : [document.createTextNode(this.words.get("backToDrag"))]),
    );
    if (state.isDrag) this.map.dragging.enable();
    else this.map.dragging.disable();

    this.renderRectangle(state.drawBounds);
    this.renderMarker(state.userLocation);
  }

  private readonly handleTouchStart = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (touch) this.model.touchStart(this.map.mouseEventToLatLng(touch));
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    const touch = event.touches[0];
    if (touch) this.model.touchMove(this.map.mouseEventToLatLng(touch));
  };

  private readonly handleTouchEnd = (): void => {
    this.model.touchEnd();
  };

  /** The drawn box is shown exactly while there is one. */
  private renderRectangle(bounds: LeafletBounds | null): void {
    if (!bounds) {
      this.rectangle?.remove();
      this.rectangle = null;
      return;
    }
    const style = { color: c(112, 248, 255), weight: 2, fillColor: c(21, 223, 243), fillOpacity: 0.18 };
    if (this.rectangle) {
      this.rectangle.setBounds(bounds);
      this.rectangle.setStyle(style);
    } else {
      this.rectangle = L.rectangle(bounds, style).addTo(this.map);
    }
  }

  private renderMarker(position: [number, number] | null): void {
    if (!position) {
      this.marker?.remove();
      this.marker = null;
      return;
    }
    if (this.marker) {
      this.marker.setLatLng(position);
      this.marker.setTooltipContent(this.words.get("yourLocation"));
      return;
    }
    const userLocationIcon = L.divIcon({
      className: "holo-location-marker",
      html: BEACON_HTML,
      iconSize: [42, 42],
      iconAnchor: [21, 21],
    });
    this.marker = L.marker(position, { icon: userLocationIcon, interactive: false })
      .bindTooltip(this.words.get("yourLocation"), {
        permanent: true,
        direction: "top",
        offset: [0, -20],
        className: "holo-location-tooltip",
      })
      .addTo(this.map);
  }
}

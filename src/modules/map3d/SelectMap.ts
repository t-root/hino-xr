// Leaflet is this plugin's own dependency: pinned in ./vendor.json, unpacked
// into ./vendor by Python. It ships no types.
// @ts-ignore
import * as L from "./vendor/leaflet/dist/leaflet-src.esm.js";
import "./vendor/leaflet/dist/leaflet.css";
import { CanvasMirror, CopySync, SharedState } from "@/core/sync";
import { isHandPointerId } from "@/core/input/dispatchHandPointer";
import type { TwoHandDomDetail } from "@/shared/contracts/input";
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

/**
 * Two hands that close less than this far apart (a share of the picture) are about to draw a region; farther
 * apart, they zoom. Drawing starts with the fingertips nearly together, and a zoom starts with the hands wide.
 */
const DRAW_FROM_WITHIN = 0.16;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

/** Wraps longitude into -180..180, as the original did before reporting an area. */
const adjustLng = (latlng: LatLng): LeafletLatLng => {
  const adjustedLng = ((((latlng.lng + 180) % 360) + 360) % 360) - 180;
  return new L.LatLng(latlng.lat, adjustedLng);
};

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, tiles by <a href="https://openstreetmap.de/">OpenStreetMap Germany</a>';
const BEACON_HTML = '<span class="holo-location-beacon"></span>';

type SelectMapOptions = Readonly<{
  /** `[northEast, southWest]` of the box being drawn or just drawn. */
  onDone: (area: [LatLng, LatLng]) => void;
}>;

/** What every copy of the map step shows. */
type MapState = Readonly<{
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
    bounds: null,
    drawBounds: null,
    locating: false,
    locationError: "",
    userLocation: null,
  });
  readonly view = new CopySync<MapViewState>({ center: { lat: 40.8, lng: -73.95 }, zoom: 13 });

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

  // ---- the region ----

  /**
   * The region between two corners, as two pinching hands (or a mouse dragged with Shift held) move them.
   * It is reported to the app as it grows; `done` is the moment the hands open or the button is let go.
   */
  box(a: LeafletLatLng, b: LeafletLatLng, done: boolean): void {
    this.handleChangeDraw(new L.LatLngBounds(a, b));
    if (done) this.handleChangeDone(new L.LatLngBounds(adjustLng(a), adjustLng(b)));
  }

  /**
   * Finds where the device is and puts the map there. Done by itself each time the plugin is opened (a jump, since
   * the map starts on the other side of the world), and by the locate button (a short flight back).
   */
  requestLocation(animate = true): void {
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
        if (leader) leader.flyTo(position, animate);
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
  private readonly hint: HTMLElement;
  /** Placed by the screen in its bar of buttons along the top, with Close and Next. */
  readonly locateButton: HTMLButtonElement;
  private readonly resizeObserver: ResizeObserver;
  private readonly sync: { publish: (view: MapViewState) => void; dispose: () => void };
  private readonly stopState: () => void;
  private rectangle: any = null;
  private marker: any = null;

  constructor(
    private readonly model: MapModel,
    private readonly words: Words,
  ) {
    const credit = h("a", "map-credit", words.node("credit"));
    credit.href = "https://www.openstreetmap.org/copyright";
    credit.target = "_blank";
    credit.rel = "noreferrer";

    // Only the crosshair every map app uses for "take me to where I am": no words.
    this.locateButton = h("button", "m3-locate", icon("locateFixed"));
    this.locateButton.type = "button";
    this.locateButton.addEventListener("click", () => model.requestLocation(true));

    this.hint = h("div", "m3-hint", words.node("drawHint"));

    this.container = h("div", "m3-map__leaflet hologram-map");
    this.root = h("div", "m3-map", credit, this.hint, this.container);

    const start = model.view.view;
    this.map = L.map(this.container, {
      center: [start.center.lat, start.center.lng],
      zoom: start.zoom,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      // Shift and drag draws the region (below); Leaflet's own use of it is to zoom to a box.
      boxZoom: false,
      // Zoom is two hands or the wheel; the +/- buttons are not drawn.
      zoomControl: false,
      // Two hands zoom by whatever the distance between them changes, so any zoom in between is allowed.
      zoomSnap: 0,
      // Leaflet re-measures on window resize after a timer of its own, per map;
      // the observer below re-measures every copy together instead.
      trackResize: false,
    });
    // OpenStreetMap Germany serves the standard OpenStreetMap style from its own servers.
    // tile.openstreetmap.org is blocked by some networks' DNS (it resolves to 127.0.0.1), and
    // CARTO's free tiles now answer every request with an "API key required" picture.
    new SharedTileLayer("https://{s}.tile.openstreetmap.de/{z}/{x}/{y}.png", {
      attribution: OSM_ATTRIBUTION,
      maxZoom: 18,
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
    // The region: two hands pinching and spreading draw it, and so does a mouse dragged with Shift held.
    this.root.addEventListener("twohand", this.handleTwoHand);
    this.container.addEventListener("mousedown", this.handleShiftDown, true);
    // A hand is pressed in as pointer events, which Leaflet 1.9 does not turn into
    // mouse events: it neither pans nor reports a drawn box. So the hand's
    // pointers are worked here, the same way for drawing and for panning.
    this.container.setAttribute("data-hand-target", "");
    // In the capture phase, and kept from Leaflet: it turns pointer events into the touch events its
    // own pan and pinch-zoom run on, so a hand drawing a box would also drag the map under it.
    this.container.addEventListener("pointerdown", this.handleHandDown, true);
    this.container.addEventListener("pointermove", this.handleHandMove, true);
    this.container.addEventListener("pointerup", this.handleHandUp, true);
    this.container.addEventListener("pointercancel", this.handleHandUp, true);
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

  flyTo(position: [number, number], animate = true): void {
    if (animate) this.map.flyTo(position, 16, { animate: true, duration: 1.2 });
    else this.map.setView(position, 16, { animate: false });
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
    this.root.removeEventListener("twohand", this.handleTwoHand);
    this.container.removeEventListener("mousedown", this.handleShiftDown, true);
    this.stopShiftDrag?.();
    this.container.removeEventListener("pointerdown", this.handleHandDown, true);
    this.container.removeEventListener("pointermove", this.handleHandMove, true);
    this.container.removeEventListener("pointerup", this.handleHandUp, true);
    this.container.removeEventListener("pointercancel", this.handleHandUp, true);
    this.map.remove();
    this.root.remove();
  }

  private render(state: MapState): void {
    this.locateButton.disabled = state.locating;
    const label = state.locationError || this.words.get("locateTitle");
    this.locateButton.title = label;
    this.locateButton.setAttribute("aria-label", label);
    this.locateButton.dataset.busy = String(state.locating);
    this.locateButton.dataset.failed = String(state.locationError !== "");

    show(this.hint, state.bounds == null && state.drawBounds == null);

    this.renderRectangle(state.drawBounds);
    this.renderMarker(state.userLocation);
  }

  /** What the two hands now closed are doing, decided when they closed: drawing a region or zooming. */
  private twoHands: "draw" | "zoom" | null = null;

  /**
   * Two pinching hands, taken here so it is not also a wheel. Closed close together (the four fingertips
   * almost touching) and then drawn apart, they draw the region, a corner at each hand. Closed already apart and
   * then spread or brought together, they zoom the map about the point between them, as two fingers do on a phone.
   */
  private readonly handleTwoHand = (event: Event): void => {
    event.preventDefault();
    const detail = (event as CustomEvent<TwoHandDomDetail>).detail;
    if (detail.phase === "start") this.twoHands = detail.distance < DRAW_FROM_WITHIN ? "draw" : "zoom";
    const at = (point: { x: number; y: number }) => this.map.mouseEventToLatLng({ clientX: point.x, clientY: point.y });
    if (this.twoHands === "draw") {
      this.model.box(at(detail.hands.left), at(detail.hands.right), detail.phase === "end");
    } else if (this.twoHands === "zoom" && detail.phase === "move" && detail.scale !== 1) {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.map.getZoom() + Math.log2(detail.scale)));
      this.map.setZoomAround(at(detail.client), zoom, { animate: false });
    }
    if (detail.phase === "end") this.twoHands = null;
  };

  /** A mouse drag with Shift held draws the region; without it, it moves the map as it always did. */
  private stopShiftDrag: (() => void) | null = null;

  private readonly handleShiftDown = (event: MouseEvent): void => {
    if (!event.shiftKey || event.button !== 0) return;
    // Before Leaflet sees it: it would otherwise start moving the map under the box.
    event.stopImmediatePropagation();
    event.preventDefault();
    const corner = this.map.mouseEventToLatLng(event);
    const move = (next: MouseEvent) => this.model.box(corner, this.map.mouseEventToLatLng(next), false);
    const up = (next: MouseEvent) => {
      this.model.box(corner, this.map.mouseEventToLatLng(next), true);
      this.stopShiftDrag?.();
    };
    this.stopShiftDrag = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      this.stopShiftDrag = null;
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  /** Where the hand last was while panning; null when it is not holding the map. */
  private handPan: { x: number; y: number } | null = null;

  private readonly handleHandDown = (event: PointerEvent): void => {
    if (!isHandPointerId(event.pointerId)) return;
    event.stopImmediatePropagation();
    this.handPan = { x: event.clientX, y: event.clientY };
  };

  private readonly handleHandMove = (event: PointerEvent): void => {
    if (!isHandPointerId(event.pointerId) || !this.handPan) return;
    event.stopImmediatePropagation();
    this.map.panBy([this.handPan.x - event.clientX, this.handPan.y - event.clientY], { animate: false });
    this.handPan = { x: event.clientX, y: event.clientY };
  };

  private readonly handleHandUp = (event: PointerEvent): void => {
    if (!isHandPointerId(event.pointerId)) return;
    event.stopImmediatePropagation();
    this.handPan = null;
  };

  /** The drawn box is shown exactly while there is one. */
  private renderRectangle(bounds: LeafletBounds | null): void {
    if (!bounds) {
      this.rectangle?.remove();
      this.rectangle = null;
      return;
    }
    // Colours come from `.m3-box` in the stylesheet, so they follow the theme.
    const style = { weight: 1, className: "m3-box" };
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

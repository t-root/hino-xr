// @ts-ignore
import * as L from "./vendor/leaflet/dist/leaflet-src.esm.js";
import "./vendor/leaflet/dist/leaflet.css";
import { CanvasMirror, CopySync, SharedState } from "@/core/sync";
import { isHandPointerId } from "@/core/input/dispatchHandPointer";
import { toLocalDelta, toLocalPoint } from "@/core/view/localPoint";
import type { TwoHandDomDetail } from "@/shared/contracts/input";
import { h, icon, type Words } from "./ui";

export type LatLng = { lat: number; lng: number };
type LeafletLatLng = LatLng & { equals?(other: LatLng): boolean };
type LeafletBounds = { _northEast: LatLng; _southWest: LatLng };
type MapEvent = { latlng: LeafletLatLng };

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

const DRAW_FROM_WITHIN = 0.16;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

const adjustLng = (latlng: LatLng): LeafletLatLng => {
  const adjustedLng = ((((latlng.lng + 180) % 360) + 360) % 360) - 180;
  return new L.LatLng(latlng.lat, adjustedLng);
};

const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors, tiles by <a href="https://openstreetmap.de/">OpenStreetMap Germany</a>';
const BEACON_HTML = '<span class="holo-location-beacon"></span>';

type SelectMapOptions = Readonly<{
  onDone: (area: [LatLng, LatLng]) => void;
}>;

type MapState = Readonly<{
  bounds: LeafletBounds | null;
  drawBounds: LeafletBounds | null;
  locating: boolean;
  locationError: string;
  userLocation: [number, number] | null;
}>;

type MapViewState = Readonly<{ center: LatLng; zoom: number; anchor?: LatLng }>;

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

  box(a: LeafletLatLng, b: LeafletLatLng, done: boolean): void {
    this.handleChangeDraw(new L.LatLngBounds(a, b));
    if (done) this.handleChangeDone(new L.LatLngBounds(adjustLng(a), adjustLng(b)));
  }

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

export class MapView {
  readonly root: HTMLDivElement;

  private readonly map: any;
  private readonly container: HTMLDivElement;
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

    this.locateButton = h("button", "m3-locate", icon("locateFixed"));
    this.locateButton.type = "button";
    this.locateButton.addEventListener("click", () => model.requestLocation(true));


    this.container = h("div", "m3-map__leaflet hologram-map");
    this.root = h("div", "m3-map", credit, this.container);

    const start = model.view.view;
    this.map = L.map(this.container, {
      center: [start.center.lat, start.center.lng],
      zoom: start.zoom,
      attributionControl: false,
      zoomAnimation: false,
      fadeAnimation: false,
      markerZoomAnimation: false,
      boxZoom: false,
      zoomControl: false,
      zoomSnap: 0,
      trackResize: false,
    });
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
    this.root.addEventListener("twohand", this.handleTwoHand);
    this.container.addEventListener("mousedown", this.handleShiftDown, true);
    this.container.setAttribute("data-hand-target", "");
    this.container.setAttribute("data-hand-plain", "");
    this.container.addEventListener("pointerdown", this.handleHandDown, true);
    this.container.addEventListener("pointermove", this.handleHandMove, true);
    this.container.addEventListener("pointerup", this.handleHandUp, true);
    this.container.addEventListener("pointercancel", this.handleHandUp, true);
    this.resizeObserver = new ResizeObserver(() => this.invalidate());
    this.resizeObserver.observe(this.container);

    this.stopState = model.state.subscribe((state) => this.render(state));
    words.bind(() => this.render(model.state.get()));
  }

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

    this.renderRectangle(state.drawBounds);
    this.renderMarker(state.userLocation);
  }

  private latLngAt(clientX: number, clientY: number) {
    const local = toLocalPoint(this.container, clientX, clientY);
    return this.map.containerPointToLatLng([local.x, local.y]);
  }

  private twoHands: "draw" | "zoom" | null = null;

  private readonly handleTwoHand = (event: Event): void => {
    event.preventDefault();
    const detail = (event as CustomEvent<TwoHandDomDetail>).detail;
    if (detail.phase === "start") this.twoHands = detail.distance < DRAW_FROM_WITHIN ? "draw" : "zoom";
    const at = (point: { x: number; y: number }) => this.latLngAt(point.x, point.y);
    if (this.twoHands === "draw") {
      this.model.box(at(detail.hands.left), at(detail.hands.right), detail.phase === "end");
    } else if (this.twoHands === "zoom" && detail.phase === "move" && detail.scale !== 1) {
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.map.getZoom() + Math.log2(detail.scale)));
      this.map.setZoomAround(at(detail.client), zoom, { animate: false });
    }
    if (detail.phase === "end") this.twoHands = null;
  };

  private stopShiftDrag: (() => void) | null = null;

  private readonly handleShiftDown = (event: MouseEvent): void => {
    if (!event.shiftKey || event.button !== 0) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    const corner = this.latLngAt(event.clientX, event.clientY);
    const move = (next: MouseEvent) => this.model.box(corner, this.latLngAt(next.clientX, next.clientY), false);
    const up = (next: MouseEvent) => {
      this.model.box(corner, this.latLngAt(next.clientX, next.clientY), true);
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

  private handPan: { x: number; y: number } | null = null;

  private readonly handleHandDown = (event: PointerEvent): void => {
    if (!isHandPointerId(event.pointerId)) return;
    event.stopImmediatePropagation();
    this.handPan = { x: event.clientX, y: event.clientY };
  };

  private readonly handleHandMove = (event: PointerEvent): void => {
    if (!isHandPointerId(event.pointerId) || !this.handPan) return;
    event.stopImmediatePropagation();
    const moved = toLocalDelta(this.container, this.handPan.x - event.clientX, this.handPan.y - event.clientY);
    this.map.panBy([moved.x, moved.y], { animate: false });
    this.handPan = { x: event.clientX, y: event.clientY };
  };

  private readonly handleHandUp = (event: PointerEvent): void => {
    if (!isHandPointerId(event.pointerId)) return;
    event.stopImmediatePropagation();
    this.handPan = null;
  };

  private renderRectangle(bounds: LeafletBounds | null): void {
    if (!bounds) {
      this.rectangle?.remove();
      this.rectangle = null;
      return;
    }
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

import type { OsmElement } from "./overpass";

/**
 * Buildings and roads from OpenFreeMap's vector tiles: OpenStreetMap data cut into tiles,
 * served by a plain CDN with no key. It is the way in when a network blocks the OpenStreetMap
 * API and every Overpass server, as some do. Heights are the tiles' own `render_height`.
 */

const TILEJSON = "https://tiles.openfreemap.org/planet";
const ZOOM = 14;
const MAX_TILES = 16;
/** Roads a person or a car uses; rails, ferries and cable cars are not roads. */
const ROAD_CLASSES = new Set([
  "motorway",
  "trunk",
  "primary",
  "secondary",
  "tertiary",
  "minor",
  "service",
  "track",
  "path",
  "pedestrian",
  "busway",
  "bridleway",
  "cycleway",
  "footway",
  "living_street",
  "residential",
  "unclassified",
]);

export type Bounds = { south: number; west: number; north: number; east: number };

type Point = { x: number; y: number };
type TileFeature = { type: number; tags: Record<string, string | number | boolean>; rings: Point[][] };
type TileLayer = { name: string; extent: number; features: TileFeature[] };

class Reader {
  pos = 0;
  constructor(
    private readonly bytes: Uint8Array,
    readonly end = bytes.length,
  ) {}

  get done(): boolean {
    return this.pos >= this.end;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.bytes[this.pos++] ?? 0;
      // Arithmetic, not bit shifts: ids and long values can pass 32 bits.
      result += (byte & 0x7f) * 2 ** shift;
      if ((byte & 0x80) === 0) return result;
      shift += 7;
    }
  }

  skip(wire: number): void {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error(`Unsupported protobuf wire type ${wire}`);
  }

  /** A length-delimited field as its own reader. */
  sub(): Reader {
    const length = this.varint();
    const reader = new Reader(this.bytes, this.pos + length);
    reader.pos = this.pos;
    this.pos += length;
    return reader;
  }

  string(): string {
    const length = this.varint();
    const text = new TextDecoder().decode(this.bytes.subarray(this.pos, this.pos + length));
    this.pos += length;
    return text;
  }

  float(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 4);
    this.pos += 4;
    return view.getFloat32(0, true);
  }

  double(): number {
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.pos, 8);
    this.pos += 8;
    return view.getFloat64(0, true);
  }
}

const zigzag = (value: number): number => (value % 2 === 1 ? -(value + 1) / 2 : value / 2);

const readValue = (reader: Reader): string | number | boolean => {
  let value: string | number | boolean = "";
  while (!reader.done) {
    const key = reader.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1) value = reader.string();
    else if (field === 2) value = reader.float();
    else if (field === 3) value = reader.double();
    else if (field === 4 || field === 5) value = reader.varint();
    else if (field === 6) value = zigzag(reader.varint());
    else if (field === 7) value = reader.varint() !== 0;
    else reader.skip(wire);
  }
  return value;
};

const readGeometry = (reader: Reader, type: number): Point[][] => {
  const rings: Point[][] = [];
  let current: Point[] = [];
  let x = 0;
  let y = 0;
  while (!reader.done) {
    const command = reader.varint();
    const id = command % 8;
    const count = Math.floor(command / 8);
    if (id === 7) {
      if (type === 3 && current.length > 0) current.push(current[0] as Point);
      continue;
    }
    for (let i = 0; i < count; i += 1) {
      x += zigzag(reader.varint());
      y += zigzag(reader.varint());
      if (id === 1) {
        if (current.length > 0) rings.push(current);
        current = [];
      }
      current.push({ x, y });
    }
  }
  if (current.length > 0) rings.push(current);
  return rings;
};

const readFeature = (reader: Reader, keys: string[], values: (string | number | boolean)[]): TileFeature => {
  const feature: TileFeature = { type: 0, tags: {}, rings: [] };
  while (!reader.done) {
    const key = reader.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 2) {
      const tags = reader.sub();
      while (!tags.done) {
        const name = keys[tags.varint()];
        const value = values[tags.varint()];
        if (name !== undefined && value !== undefined) feature.tags[name] = value;
      }
    } else if (field === 3) feature.type = reader.varint();
    else if (field === 4) feature.rings = readGeometry(reader.sub(), feature.type);
    else reader.skip(wire);
  }
  return feature;
};

const readLayer = (reader: Reader): TileLayer => {
  const layer: TileLayer = { name: "", extent: 4096, features: [] };
  const keys: string[] = [];
  const values: (string | number | boolean)[] = [];
  const featureReaders: Reader[] = [];
  while (!reader.done) {
    const key = reader.varint();
    const field = Math.floor(key / 8);
    const wire = key % 8;
    if (field === 1) layer.name = reader.string();
    else if (field === 2) featureReaders.push(reader.sub());
    else if (field === 3) keys.push(reader.string());
    else if (field === 4) values.push(readValue(reader.sub()));
    else if (field === 5) layer.extent = reader.varint();
    else reader.skip(wire);
  }
  // Keys and values come after the features in some encoders, so features are read last.
  layer.features = featureReaders.map((feature) => readFeature(feature, keys, values));
  return layer;
};

/** The layers of one Mapbox vector tile, and nothing else of it. */
export const decodeTile = (bytes: Uint8Array): TileLayer[] => {
  const reader = new Reader(bytes);
  const layers: TileLayer[] = [];
  while (!reader.done) {
    const key = reader.varint();
    const field = Math.floor(key / 8);
    if (field === 3) layers.push(readLayer(reader.sub()));
    else reader.skip(key % 8);
  }
  return layers;
};

const tileOf = (lat: number, lng: number): { x: number; y: number } => {
  const n = 2 ** ZOOM;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lng + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n),
  };
};

const lngOf = (tileX: number, px: number, extent: number): number => ((tileX + px / extent) / 2 ** ZOOM) * 360 - 180;
const latOf = (tileY: number, py: number, extent: number): number => {
  const n = Math.PI - (2 * Math.PI * (tileY + py / extent)) / 2 ** ZOOM;
  return (Math.atan(Math.sinh(n)) * 180) / Math.PI;
};

/** Twice the signed area; in tile coordinates (y down) an outer ring is positive. */
const area = (ring: Point[]): number => {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i] as Point;
    const b = ring[i + 1] as Point;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
};

const touches = (points: { lat: number; lon: number }[], bounds: Bounds): boolean => {
  let south = Infinity;
  let north = -Infinity;
  let west = Infinity;
  let east = -Infinity;
  for (const point of points) {
    south = Math.min(south, point.lat);
    north = Math.max(north, point.lat);
    west = Math.min(west, point.lon);
    east = Math.max(east, point.lon);
  }
  return north >= bounds.south && south <= bounds.north && east >= bounds.west && west <= bounds.east;
};

let tileTemplate: Promise<string> | null = null;

const template = (signal?: AbortSignal): Promise<string> => {
  tileTemplate ??= fetch(TILEJSON, signal ? { signal } : {})
    .then((response) => {
      if (!response.ok) throw new Error(`OpenFreeMap returned ${response.status}`);
      return response.json() as Promise<{ tiles?: string[] }>;
    })
    .then((json) => {
      const url = json.tiles?.[0];
      if (!url) throw new Error("OpenFreeMap named no tiles");
      return url;
    })
    .catch((error: unknown) => {
      tileTemplate = null;
      throw error;
    });
  return tileTemplate;
};

/** Buildings or roads inside `bounds`, shaped like what Overpass returns for them. */
export async function queryVectorTiles(
  what: "building" | "highway",
  bounds: Bounds,
  signal?: AbortSignal,
): Promise<{ elements: OsmElement[] }> {
  const first = tileOf(bounds.north, bounds.west);
  const last = tileOf(bounds.south, bounds.east);
  const count = (last.x - first.x + 1) * (last.y - first.y + 1);
  if (count > MAX_TILES) throw new Error("The area is too large for tiles");
  const url = await template(signal);
  const wanted = what === "building" ? "building" : "transportation";
  const elements: OsmElement[] = [];

  for (let tileX = first.x; tileX <= last.x; tileX += 1) {
    for (let tileY = first.y; tileY <= last.y; tileY += 1) {
      const response = await fetch(
        url.replace("{z}", String(ZOOM)).replace("{x}", String(tileX)).replace("{y}", String(tileY)),
        signal ? { signal } : {},
      );
      if (response.status === 404 || response.status === 204) continue;
      if (!response.ok) throw new Error(`OpenFreeMap returned ${response.status}`);
      const layer = decodeTile(new Uint8Array(await response.arrayBuffer())).find((item) => item.name === wanted);
      if (!layer) continue;
      const idBase = (tileX * 16384 + tileY) * 200000;
      layer.features.forEach((feature, index) => {
        const geometryOf = (ring: Point[]) =>
          ring.map((point) => ({ lat: latOf(tileY, point.y, layer.extent), lon: lngOf(tileX, point.x, layer.extent) }));
        if (what === "building") {
          if (feature.type !== 3) return;
          // A part that floats above the ground would stand on top of the building under it.
          if (Number(feature.tags.render_min_height ?? 0) > 0) return;
          // The tiles give 5 when OpenStreetMap has no height or levels for a building, so 5 means "unknown".
          const height = Number(feature.tags.render_height ?? 0);
          feature.rings.forEach((ring, ringIndex) => {
            if (ring.length < 4 || area(ring) <= 0) return;
            const geometry = geometryOf(ring);
            if (!touches(geometry, bounds)) return;
            elements.push({
              id: idBase + index * 8 + Math.min(ringIndex, 7),
              tags: { building: "yes", ...(height > 0 && height !== 5 ? { height: String(height) } : {}) },
              geometry,
            });
          });
        } else {
          if (feature.type !== 2 || !ROAD_CLASSES.has(String(feature.tags.class ?? ""))) return;
          feature.rings.forEach((line, lineIndex) => {
            if (line.length < 2) return;
            const geometry = geometryOf(line);
            if (!touches(geometry, bounds)) return;
            elements.push({
              id: idBase + index * 8 + Math.min(lineIndex, 7),
              tags: { highway: String(feature.tags.class) },
              geometry,
            });
          });
        }
      });
    }
  }
  return { elements };
}

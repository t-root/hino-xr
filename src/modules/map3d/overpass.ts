/** A way as Overpass returns it with `out body geom`. */
export type OsmElement = {
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
};

type OsmResult = { elements: OsmElement[] };

const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function getBounds(query: string) {
  const match = query.match(
    /\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/,
  );
  if (!match) return null;
  return { south: match[1], west: match[2], north: match[3], east: match[4] };
}

async function queryOsmMap(query: string, signal?: AbortSignal): Promise<OsmResult> {
  const bounds = getBounds(query);
  if (!bounds) throw new Error("Unable to determine selected map bounds");

  const url = new URL("https://api.openstreetmap.org/api/0.6/map");
  url.searchParams.set("bbox", `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`);
  const response = await fetch(url, signal ? { signal } : {});
  if (!response.ok) throw new Error(`OpenStreetMap returned ${response.status}`);

  const document = new DOMParser().parseFromString(await response.text(), "application/xml");
  const nodes = new Map<string, { lat: number; lon: number }>();
  document.querySelectorAll("node").forEach((node) => {
    nodes.set(node.getAttribute("id") || "", {
      lat: Number(node.getAttribute("lat")),
      lon: Number(node.getAttribute("lon")),
    });
  });

  const desiredTag = query.includes('["building"]') ? "building" : "highway";
  const elements = Array.from(document.querySelectorAll("way")).flatMap((way): OsmElement[] => {
    const tags = Object.fromEntries(
      Array.from(way.querySelectorAll(":scope > tag")).map((tag) => [
        tag.getAttribute("k") || "",
        tag.getAttribute("v") || "",
      ]),
    );
    if (!tags[desiredTag]) return [];
    const geometry = Array.from(way.querySelectorAll(":scope > nd"))
      .map((nd) => nodes.get(nd.getAttribute("ref") || ""))
      .filter((point): point is { lat: number; lon: number } => Boolean(point));
    return [{ id: Number(way.getAttribute("id")), tags, geometry }];
  });
  return { elements };
}

/**
 * Runs a query against a small pool of public Overpass instances. Public
 * instances occasionally become saturated, so a timeout on one should not
 * prevent the map viewer from loading its data.
 */
export async function queryOverpass(query: string, signal?: AbortSignal): Promise<OsmResult> {
  let lastError: unknown;

  // The normal OSM map API is available from the same service used for map
  // tiles and is usually more reliable on restricted networks. It returns all
  // map data inside the selected box; we keep only the requested feature type.
  try {
    return await queryOsmMap(query, signal);
  } catch (error) {
    lastError = error;
    if (signal?.aborted) throw error;
  }

  for (const endpoint of OVERPASS_ENDPOINTS) {
    if (signal?.aborted) {
      throw new DOMException("Overpass request cancelled", "AbortError");
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 14000);
    const abortRequest = () => controller.abort();
    signal?.addEventListener("abort", abortRequest, { once: true });

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        body: query,
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Overpass returned ${response.status}`);
      }
      return (await response.json()) as OsmResult;
    } catch (error) {
      lastError = error;
      if (signal?.aborted) throw error;
    } finally {
      window.clearTimeout(timeout);
      signal?.removeEventListener("abort", abortRequest);
    }
  }

  throw lastError || new Error("No Overpass instance is currently available");
}

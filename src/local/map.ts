import * as fs from 'node:fs';
import * as path from 'node:path';
import { getInfo } from '../auth';
import { ee } from '../ee';

export interface MapLayer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vis: any;
  name: string;
  shown: boolean;
  opacity: number;
}

export interface MapCapture {
  layers: MapLayer[];
  region?: unknown;
  center?: [number, number];
  zoom?: number;
  basemap?: string;
  output?: string;
}

type MapId = {
  urlFormat?: string;
};

type Mappable = {
  getMap(
    params: Record<string, unknown>,
    callback: (mapId?: MapId, error?: unknown) => void,
  ): void;
};

type RenderedLayer = {
  name: string;
  opacity: number;
  shown: boolean;
  url: string;
};

const MAPLIBRE_VERSION = '6.2.0';

function tileUrl(object: Mappable, vis: Record<string, unknown>): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof object?.getMap !== 'function') {
      reject(new Error('Map.addLayer 仅支持可生成地图瓦片的 GEE 对象'));
      return;
    }
    object.getMap(vis, (mapId, error) => {
      if (error) {
        reject(new Error(String(error)));
        return;
      }
      if (!mapId) {
        reject(new Error('Earth Engine 未返回地图 ID'));
        return;
      }
      if (!mapId.urlFormat) ee.data.getTileUrl(mapId, 0, 0, 0);
      if (mapId.urlFormat) resolve(mapId.urlFormat);
      else reject(new Error('Earth Engine 未返回瓦片地址'));
    });
  });
}

function walkCoordinates(value: unknown, bounds: [number, number, number, number]): void {
  if (!Array.isArray(value)) return;
  if (
    value.length >= 2
    && typeof value[0] === 'number'
    && typeof value[1] === 'number'
  ) {
    bounds[0] = Math.min(bounds[0], value[0]);
    bounds[1] = Math.min(bounds[1], value[1]);
    bounds[2] = Math.max(bounds[2], value[0]);
    bounds[3] = Math.max(bounds[3], value[1]);
    return;
  }
  for (const child of value) walkCoordinates(child, bounds);
}

async function regionBounds(
  region: unknown,
): Promise<[number, number, number, number] | undefined> {
  if (!region) return undefined;
  try {
    const value = typeof (region as { evaluate?: unknown }).evaluate === 'function'
      ? await getInfo(region)
      : region;
    const coordinates = (value as { coordinates?: unknown })?.coordinates;
    const bounds: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    walkCoordinates(coordinates, bounds);
    return bounds.every(Number.isFinite) ? bounds : undefined;
  } catch {
    return undefined;
  }
}

function json(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function mapHtml(
  layers: RenderedLayer[],
  map: MapCapture,
  bounds?: [number, number, number, number],
): string {
  const data = json({
    layers,
    bounds,
    center: map.center,
    zoom: map.zoom,
    basemap: map.basemap?.toUpperCase() || 'ROADMAP',
  });
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>GEE Map</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.css">
  <style>
    html, body, #map { height: 100%; margin: 0; }
    #layers {
      position: absolute;
      top: 10px;
      left: 10px;
      z-index: 1;
      max-width: min(320px, calc(100% - 80px));
      padding: 8px 10px;
      border-radius: 4px;
      background: rgb(255 255 255 / 90%);
      font: 13px/1.5 sans-serif;
    }
    #layers label { display: block; }
  </style>
</head>
<body>
  <div id="map"></div>
  <div id="layers"></div>
  <script type="module">
    import * as maplibregl from 'https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/maplibre-gl.mjs';

    const data = ${data};
    const satellite = data.basemap === 'SATELLITE' || data.basemap === 'HYBRID';
    const terrain = data.basemap === 'TERRAIN';
    const baseUrl = satellite
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : terrain
        ? 'https://tile.opentopomap.org/{z}/{x}/{y}.png'
        : 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
    const attribution = satellite
      ? 'Tiles &copy; Esri'
      : terrain
        ? '&copy; OpenStreetMap contributors, SRTM | Map style &copy; OpenTopoMap'
        : '&copy; OpenStreetMap contributors';
    const map = new maplibregl.Map({
      container: 'map',
      style: {
        version: 8,
        sources: {
          basemap: { type: 'raster', tiles: [baseUrl], tileSize: 256, attribution },
        },
        layers: [{ id: 'basemap', type: 'raster', source: 'basemap' }],
      },
      center: data.center || [0, 20],
      zoom: data.zoom ?? 2,
    });
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }));
    map.on('load', () => {
      const panel = document.getElementById('layers');
      data.layers.forEach((layer, index) => {
        const id = 'gee-' + index;
        map.addSource(id, { type: 'raster', tiles: [layer.url], tileSize: 256 });
        map.addLayer({
          id,
          type: 'raster',
          source: id,
          layout: { visibility: layer.shown ? 'visible' : 'none' },
          paint: { 'raster-opacity': layer.opacity },
        });
        const label = document.createElement('label');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = layer.shown;
        input.addEventListener('change', () => {
          map.setLayoutProperty(id, 'visibility', input.checked ? 'visible' : 'none');
        });
        label.append(input, ' ' + layer.name);
        panel.append(label);
      });
      if (data.bounds && !data.center) {
        map.fitBounds(
          [[data.bounds[0], data.bounds[1]], [data.bounds[2], data.bounds[3]]],
          { padding: 40, maxZoom: data.zoom ?? 14 },
        );
      }
    });
  </script>
</body>
</html>
`;
}

export async function renderMap(
  map: MapCapture,
  scriptPath: string,
): Promise<string | undefined> {
  if (!map.layers.length) return undefined;

  const layers = await Promise.all(map.layers.map(async (layer) => ({
    name: layer.name,
    opacity: layer.opacity,
    shown: layer.shown,
    url: await tileUrl(layer.image, layer.vis || {}),
  })));
  const output = map.output || path.join(
    process.cwd(),
    'maps',
    path.basename(scriptPath, path.extname(scriptPath)).replace(/-/g, '_') + '.html',
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, mapHtml(layers, map, await regionBounds(map.region)));
  map.output = output;
  console.log('[Map] ' + output);
  return output;
}

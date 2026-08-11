import * as fs from 'node:fs';
import * as path from 'node:path';
import { ee } from '../ee';
import { runtime } from '../local/runtime';
import type { DownloadOptions, TilingOptions } from './export-col';
import { makeTileRegions, mergeTiles } from './export-tile';
import { log, mapConcurrent } from './utilize';

type GetDownloadUrlGridParams = {
  region?: ee.Geometry;
  scale?: number;
  crs?: string;
  crs_transform?: number[];
  dimensions?: number[];
};

function regionFromBounds(bounds: TilingOptions['bounds']): ee.Geometry {
  return ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);
}

function getGridParams(
  options: DownloadOptions,
  bounds?: TilingOptions['bounds']
): GetDownloadUrlGridParams {
  const box = bounds ?? options.bounds;

  // cellsize：网格由 transform+dimensions 决定，不需要 region
  if (options.cellsize != null && options.crsTransform == null) {
    if (box == null) throw new Error('cellsize 需要 bounds: [xmin, ymin, xmax, ymax]');
    const [xmin, ymin, xmax, ymax] = box;
    const cellsize = options.cellsize;
    return {
      crs: options.crs ?? 'EPSG:4326',
      crs_transform: [cellsize, 0, xmin, 0, -cellsize, ymax],
      dimensions: [
        Math.round((xmax - xmin) / cellsize),
        Math.round((ymax - ymin) / cellsize)
      ]
    };
  }

  const params: GetDownloadUrlGridParams = {
    region: options.region ?? (box != null ? regionFromBounds(box) : undefined)
  };
  if (options.crs != null) params.crs = options.crs;
  if (options.crsTransform != null) params.crs_transform = options.crsTransform;
  else if (options.scale != null) params.scale = options.scale;
  return params;
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
}

async function downloadFile(
  image: ee.Image,
  filename: string,
  options: DownloadOptions,
  bounds?: TilingOptions['bounds']
): Promise<string> {
  const host = runtime()._host;
  if (!host) throw new Error('本地导出宿主未初始化');

  const params = {
    name: path.basename(filename, path.extname(filename)),
    format: options.format ?? 'GEO_TIFF',
    ...getGridParams(options, bounds)
  };
  const retries = options.retries ?? 3;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      const url = await host.getDownloadUrl(image, params);
      const response = await (options.fetch ?? fetch)(url);
      if (!response.ok) throw new Error('HTTP ' + response.status);
      fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
      return filename;
    } catch (error) {
      if (attempt + 1 >= retries) throw error;
      await retryDelay(attempt);
    }
  }
}

export async function export_img(
  image: ee.Image,
  filename: string,
  options: DownloadOptions
): Promise<string> {
  if (fs.existsSync(filename)) {
    return filename; // 跳过
  }

  if (options.tiling) await export_img_grids(image, filename, options);
  else await downloadFile(image, filename, options);

  log(options, '完成：' + path.basename(filename));
  return filename;
}


export async function export_img_grids(
  image: ee.Image,
  filename: string,
  options: DownloadOptions
): Promise<string> {
  if (fs.existsSync(filename)) return filename;
  const tiling = options.tiling!;
  const crs = options.crs ?? tiling.crs ?? 'EPSG:4326';
  const regions = makeTileRegions(tiling, crs);
  const name = path.basename(filename, path.extname(filename));
  const outdir = path.dirname(filename);
  const tiles = regions.map((_, index) =>
    path.join(outdir, name + '_tile_' + index + '.tif'));
  fs.mkdirSync(outdir, { recursive: true });

  try {
    await mapConcurrent(
      regions,
      tiling.concurrency ?? regions.length,
      ({ bounds, region }, index) => downloadFile(image, tiles[index],
        { ...options, crs, region },
        bounds
      )
    );
    mergeTiles(tiles, filename, tiling, crs);
    return filename;
  } finally {
    tiles.forEach((tile) => fs.rmSync(tile, { force: true }));
  }
}

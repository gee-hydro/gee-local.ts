import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtime } from '../local/runtime';
import type { DownloadOptions } from './export-col';
import { makeTileRegions, mergeTiles } from './export-tile';
import { log, mapConcurrent } from './utilize';

type GetDownloadUrlGridParams = {
  region?: unknown;
  scale?: number;
  crs?: string;
  crs_transform?: number[];
  dimensions?: number[];
};

function getGridParams(
  region: unknown,
  options: DownloadOptions
): GetDownloadUrlGridParams {
  const params: GetDownloadUrlGridParams = { region };
  if (options.crs != null) params.crs = options.crs;
  if (options.crsTransform != null) {
    params.crs_transform = options.crsTransform;
    return params;
  }
  if (options.cellsize == null) {
    if (options.scale != null) params.scale = options.scale;
    return params;
  }

  const [xmin, ymin, xmax, ymax] = region as [number, number, number, number];
  const cellsize = options.cellsize;
  return {
    crs: 'EPSG:4326',
    crs_transform: [cellsize, 0, xmin, 0, -cellsize, ymax],
    dimensions: [
      Math.round((xmax - xmin) / cellsize),
      Math.round((ymax - ymin) / cellsize)
    ]
  };
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
}

async function downloadFile(
  image: unknown,
  filename: string,
  options: DownloadOptions
): Promise<string> {
  const host = runtime()._host;
  if (!host) throw new Error('本地导出宿主未初始化');

  const params = {
    name: path.basename(filename, path.extname(filename)),
    format: options.format ?? 'GEO_TIFF',
    ...getGridParams(options.region, options)
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
  image: unknown,
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
  image: unknown,
  filename: string,
  options: DownloadOptions
): Promise<string> {
  const tiling = options.tiling!;
  const regions = makeTileRegions(tiling);
  const name = path.basename(filename, path.extname(filename));
  const outdir = path.dirname(filename);
  const tiles = regions.map((_, index) =>
    path.join(outdir, name + '_tile_' + index + '.tif'));
  fs.mkdirSync(outdir, { recursive: true });

  try {
    await mapConcurrent(
      regions,
      tiling.concurrency ?? regions.length,
      (region, index) => downloadFile(image, tiles[index],
        { ...options, region }
      )
    );
    mergeTiles(tiles, filename, tiling);
    return filename;
  } finally {
    tiles.forEach((tile) => fs.rmSync(tile, { force: true }));
  }
}

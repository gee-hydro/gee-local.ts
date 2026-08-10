import * as fs from 'node:fs';
import * as path from 'node:path';
import { runtime } from '../local/runtime.js';
import type { DownloadOptions } from './export-col.js';
import { exportTiles } from './export-tile.js';
import { log } from './utilize.js';

type GetDownloadUrlGridParams = {
  region?: unknown;
  scale?: number;
  crs?: string;
  crs_transform?: number[];
  dimensions?: number[];
};

function getGridParams(
  region: unknown,
  options: DownloadOptions,
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
      Math.round((ymax - ymin) / cellsize),
    ],
  };
}

export function getDownloadParams(
  name: string,
  region: unknown,
  options: DownloadOptions,
): Record<string, unknown> {
  return {
    name,
    format: options.format ?? 'GEO_TIFF',
    filePerBand: options.filePerBand ?? false,
    ...getGridParams(region, options),
  };
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
}

async function downloadFile(
  image: unknown,
  filename: string,
  options: DownloadOptions,
  params: Record<string, unknown>,
): Promise<string> {
  const host = runtime()._host;
  if (!host) throw new Error('本地导出宿主未初始化');

  const retries = options.retries ?? 3;
  let lastError = '';
  for (let attempt = 0; attempt < retries; attempt += 1) {
    let url: string;
    try {
      url = await host.getDownloadUrl(image, params);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      const transient = /socket hang up|Invalid JSON|ECONNRESET|ETIMEDOUT/i
        .test(lastError);
      if (!transient || attempt + 1 >= retries) throw error;
      await retryDelay(attempt);
      continue;
    }

    try {
      const response = await (options.fetch ?? fetch)(url);
      if (response.ok) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
        return filename;
      }

      lastError = typeof response.text === 'function'
        ? await response.text()
        : 'HTTP ' + response.status;
      if (response.status !== 429 && response.status !== 503) break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }

    if (attempt + 1 < retries) await retryDelay(attempt);
  }
  throw new Error('下载失败：' + path.basename(filename) + ': ' + lastError);
}

export async function export_img(
  image: unknown,
  filename: string,
  options: DownloadOptions,
): Promise<string> {
  const name = path.basename(filename, path.extname(filename));
  if (fs.existsSync(filename)) {
    log(options, '跳过：' + path.basename(filename));
    return filename;
  }

  if (options.tiling) {
    await exportTiles({
      filename,
      name,
      outdir: options.outdir,
      tiling: options.tiling,
      download: (region, tileName, tileFile) => downloadFile(
        image,
        tileFile,
        options,
        getDownloadParams(tileName, region, options),
      ),
    });
  } else {
    await downloadFile(
      image,
      filename,
      options,
      getDownloadParams(name, options.region, options),
    );
  }

  log(options, '完成：' + path.basename(filename));
  return filename;
}

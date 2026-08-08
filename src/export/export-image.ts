import * as fs from 'node:fs';
import * as path from 'node:path';
import * as tile from './export-tile.js';
import * as util from './utilize.js';
import { runtime, type RuntimeHost } from '../local/runtime.js';
import type { DownloadOptions } from './export.js';

export function getDownloadParams(
  name: string,
  region: unknown,
  options: DownloadOptions,
): Record<string, unknown> {
  return {
    name,
    region,
    format: options.format || 'GEO_TIFF',
    filePerBand: options.filePerBand || false,
  };
}

function retryDelay(attempt: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 2000 * 2 ** attempt));
}

async function download_file(
  image: unknown,
  filename: string,
  options: DownloadOptions,
  params: unknown,
  host: RuntimeHost,
): Promise<string> {
  const retries = options.retries == null ? 3 : Number(options.retries);
  let last_error = '';

  for (let attempt = 0; attempt < retries; attempt += 1) {
    let url: string;
    try {
      url = await host.getDownloadUrl(image, params);
    } catch (error) {
      last_error = error instanceof Error ? error.message : String(error);
      const transient = /socket hang up|Invalid JSON|ECONNRESET|ETIMEDOUT/i
        .test(last_error);
      if (!transient || attempt + 1 >= retries) throw error;
      await retryDelay(attempt);
      continue;
    }

    try {
      const response = await (options.fetch || fetch)(url);
      if (response.ok) {
        fs.mkdirSync(path.dirname(filename), { recursive: true });
        fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
        return filename;
      }

      last_error = typeof response.text === 'function'
        ? await response.text()
        : 'HTTP ' + response.status;
      if (response.status !== 429 && response.status !== 503) break;
    } catch (error) {
      last_error = error instanceof Error ? error.message : String(error);
    }

    if (attempt + 1 < retries) await retryDelay(attempt);
  }
  throw new Error('下载失败：' + path.basename(filename) + ': ' + last_error);
}

export async function export_img(
  image: unknown,
  filename: string,
  options: DownloadOptions,
): Promise<string> {
  const name = path.basename(filename, path.extname(filename));
  if (fs.existsSync(filename)) {
    util.log(options, '跳过：' + path.basename(filename));
    return filename;
  }

  const host = runtime()._host;
  if (!host) throw new Error('本地导出宿主未初始化');

  if (!options.tiling) {
    const params = getDownloadParams(name, options.region, options);
    await download_file(image, filename, options, params, host);
  } else {
    await tile.exportTiles({
      image,
      filename,
      name,
      options,
      host,
      downloadFile: download_file,
      getDownloadParams,
    });
  }

  util.log(options, '完成：' + path.basename(filename));
  return filename;
}

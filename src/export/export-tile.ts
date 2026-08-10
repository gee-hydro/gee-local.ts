import * as fs from 'node:fs';
import * as path from 'node:path';
import { ee } from '../ee';
import { runtime } from '../local/runtime.js';
import type { TilingOptions } from './export-col.js';
import { mapConcurrent } from './utilize.js';

type ExportTilesOptions = {
  filename: string;
  name: string;
  outdir: string;
  tiling: TilingOptions;
  download(
    region: unknown,
    name: string,
    filename: string,
  ): Promise<string>;
};

function makeTileRegions(tiling: TilingOptions): unknown[] {
  const [xmin, ymin, xmax, ymax] = tiling.bounds;
  const rows = tiling.rows ?? 1;
  const cols = tiling.cols ?? 1;
  const width = (xmax - xmin) / cols;
  const height = (ymax - ymin) / rows;
  const regions = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      regions.push(ee.Geometry.Rectangle(
        [
          xmin + width * col,
          ymin + height * row,
          xmin + width * (col + 1),
          ymin + height * (row + 1),
        ],
        tiling.crs ?? 'EPSG:4326',
        false,
      ));
    }
  }
  return regions;
}

function mergeTiles(
  tiles: string[],
  filename: string,
  tiling: TilingOptions,
): void {
  const host = runtime()._host;
  if (!host?.gdalWarp) {
    throw new Error('gdalWarp 仅在 gee-helper 本地运行时可用');
  }
  const [xmin, ymin, xmax, ymax] = tiling.bounds;
  const [width, height] = tiling.dimensions;
  host.gdalWarp([
    '-q', '-overwrite', '-t_srs', tiling.crs ?? 'EPSG:4326',
    '-te', String(xmin), String(ymin), String(xmax), String(ymax),
    '-ts', String(width), String(height),
    '-r', tiling.resampling ?? 'average',
    '-srcnodata', String(tiling.srcNoData ?? 255),
    '-dstnodata', String(tiling.dstNoData ?? -9999),
    '-ot', tiling.dataType ?? 'Float32',
    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
    ...tiles,
    filename,
  ]);
}

export async function exportTiles({
  filename,
  name,
  outdir,
  tiling,
  download,
}: ExportTilesOptions): Promise<void> {
  const regions = makeTileRegions(tiling);
  fs.mkdirSync(outdir, { recursive: true });
  const temporary = fs.mkdtempSync(path.join(outdir, '.tmp-' + name + '-'));

  try {
    const tiles = await mapConcurrent(
      regions,
      tiling.concurrency ?? regions.length,
      (region, index) => {
        const tileName = name + '_tile_' + index;
        const tileFile = path.join(temporary, tileName + '.tif');
        return download(region, tileName, tileFile);
      },
    );
    mergeTiles(tiles, filename, tiling);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

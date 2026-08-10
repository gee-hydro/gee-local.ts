import { ee } from '../ee';
import { runtime } from '../local/runtime';
import type { TilingOptions } from './export-col';

type TileRegion = {
  bounds: TilingOptions['bounds'];
  region: unknown;
};

export function makeTileRegions(
  tiling: TilingOptions,
  crs: string
): TileRegion[] {
  const [xmin, ymin, xmax, ymax] = tiling.bounds;
  const rows = tiling.rows ?? 1;
  const cols = tiling.cols ?? 1;
  const width = (xmax - xmin) / cols;
  const height = (ymax - ymin) / rows;
  const regions: TileRegion[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const bounds: TilingOptions['bounds'] = [
        xmin + width * col,
        ymin + height * row,
        xmin + width * (col + 1),
        ymin + height * (row + 1)
      ];
      regions.push({
        bounds,
        region: ee.Geometry.Rectangle(bounds, crs, false)
      });
    }
  }
  return regions;
}

export function mergeTiles(
  tiles: string[],
  filename: string,
  tiling: TilingOptions,
  crs: string
): void {
  const host = runtime()._host;
  if (!host?.gdalWarp) {
    throw new Error('gdalWarp 仅在 gee-helper 本地运行时可用');
  }

  const [xmin, ymin, xmax, ymax] = tiling.bounds;
  const size = tiling.dimensions
    ? ['-ts', ...tiling.dimensions.map(String)]
    : [];
  host.gdalWarp([
    '-q', '-overwrite', '-t_srs', crs,
    '-te', String(xmin), String(ymin), String(xmax), String(ymax),
    ...size,
    '-r', tiling.resampling ?? 'average',
    '-srcnodata', String(tiling.srcNoData ?? 255),
    '-dstnodata', String(tiling.dstNoData ?? -9999),
    '-ot', tiling.dataType ?? 'Float32',
    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
    ...tiles,
    filename
  ]);
}

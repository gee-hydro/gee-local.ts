// OPERA DSWx-HLS 水体比例。
// https://developers.google.com/earth-engine/datasets/catalog/OPERA_DSWX_L3_V1_HLS
import * as path from 'node:path';
import { ee } from '../ee';
import {
  export_col,
  export_img,
  listGroups,
  type Collection,
  type DownloadOptions as ExportDownloadOptions,
  type Group,
} from '../export/export-col';
import col_frac_valid = require('../export/frac_valid');
import { resample, resampleOptions } from '../export/resample';

export interface ImageCollection extends Collection {
  filter(filter: unknown): ImageCollection;
}

export type BuildWater = (images: any) => any;

export interface BaseOptions {
  bounds?: [number, number, number, number];
  outdir?: string;
  prefix?: string;
  suffixPattern?: RegExp;
  period?: string;
  maxGroups?: number;
  concurrency?: number;
  buildWater?: BuildWater;
}

export interface ValidOptions
  extends BaseOptions {
  qualityScale?: number;
  minValidFraction?: number;
}

export interface DownloadOptions
  extends BaseOptions {
  groups?: Group[];
  sourceCellsize?: number;
  cellsize?: number;
  tiling?: ExportDownloadOptions['tiling'];
}

function mosaicWater(images: any): any {
  return images.map((image: any) => {
    const binary = image.select('BWTR_Binary_water');
    return binary.eq(1)
      .updateMask(binary.lt(252))
      .toFloat();
  }).mosaic();
}

/** 检索各时段有效观测比例，结果写入 all.csv 和 selected.csv。 */
export async function frac_valid(collection: ImageCollection, {
  bounds = [110.67, 32.42, 111.73, 33.07],
  outdir = path.join(process.cwd(), 'data', 'surface_water_hls'),
  prefix = 'DSWX_water_fraction_',
  suffixPattern = /_([^_]+)$/,
  period = '1d',
  maxGroups = -1,
  concurrency = 4,
  qualityScale = 500,
  minValidFraction = 0.9,
  buildWater = mosaicWater,
}: ValidOptions = {}): Promise<Group[]> {
  const region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);
  const groups = await listGroups(collection, {
    prefix,
    suffixPattern,
    maxGroups,
    period,
  });

  return col_frac_valid(collection, groups, {
    outdir,
    prefix,
    concurrency,
    buildImage: buildWater,
    qualityOptions: {
      targetRegion: region,
      qualityScale,
      minQuality: minValidFraction,
    },
  });
}

/** 下载水体比例；groups 可直接使用 frac_valid 的返回值。 */
export async function download(col: ImageCollection, {
  bounds = [110.67, 32.42, 111.73, 33.07],
  outdir = path.join(process.cwd(), 'data', 'surface_water_hls'),
  groups,
  prefix = 'DSWX_water_fraction_',
  suffixPattern = /_([^_]+)$/,
  period = '1d',
  maxGroups = -1,
  concurrency = 4,
  buildWater = mosaicWater,
  sourceCellsize = 1 / 3600,
  cellsize = 1 / 1200,
  tiling,
}: DownloadOptions = {}): Promise<Group[]> {
  const region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);
  const selected = groups ?? await listGroups(col, {
    prefix,
    suffixPattern,
    maxGroups,
    period,
  });
  const grid = resampleOptions(bounds, cellsize, sourceCellsize);

  function exportImage(group: Group) {
    const source = col.filter(
      ee.Filter.inList('system:index', group.indices),
    );
    const image = resample(buildWater(source), grid)
      .rename('water_fraction')
      .unmask(-9999, false)
      .clip(region);
    const filename = path.join(outdir, group.name + '.tif');
    return export_img(image, filename, {
      outdir,
      region,
      crs: grid.crs,
      crsTransform: grid.crsTransform_target,
      tiling,
    });
  }

  await export_col(col, {
    groups: selected,
    concurrency,
    exportImage,
  });
  return selected;
}

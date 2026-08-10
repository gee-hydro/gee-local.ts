import * as path from 'node:path';
import { ee } from '../ee';
import * as io from './IO';
import * as util from './utilize';

type eeCollection = {
  filter(filter: unknown): unknown;
};

type Group = {
  key: string;
  name: string;
  indices: string[]; // index of system_index
};

type QualityRecord = {
  group_key: string;
  filename: string;
  source_count: number;
  frac_valid: number;
};

type CsvRow = {
  group_key: string;
  filename: string;
  source_count: string | number;
  frac_valid: string | number;
};

type QualityOptions = {
  targetRegion: unknown;
  qualityScale: number;
  minQuality: number;
};

type FilterOptions = {
  outdir: string;
  prefix: string;
  concurrency?: number;
  buildImage: (source: unknown, options?: unknown) => unknown;
  buildImageOptions?: unknown;
  qualityOptions: QualityOptions;
  indexProperty?: string;
  extension?: string;
};

function readCsv(filename: string): Map<string, QualityRecord> {
  const rows = io.read_csv(filename) as CsvRow[];
  rows.forEach((row) => {
    row.source_count = Number(row.source_count);
    row.frac_valid = Number(row.frac_valid);
  });
  return new Map(rows.map((row) => [row.group_key, row as QualityRecord]));
}

function writeCsv(filename: string, records: QualityRecord[]): void {
  io.write_csv(filename, records, [
    'group_key',
    'filename',
    'source_count',
    'frac_valid',
  ]);
}

function appendCsv(filename: string, records: QualityRecord[]): void {
  io.append_csv(filename, records, [
    'group_key',
    'filename',
    'source_count',
    'frac_valid',
  ]);
}


function image_frac_valid(image: unknown, options: QualityOptions): unknown {
  const valid = ee.Image(image)
    .mask()
    .rename('valid')
    .unmask(0, false);
  return ee.Number(valid.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: options.targetRegion,
    scale: options.qualityScale,
    maxPixels: 1e8,
    tileScale: 2,
  }).get('valid'));
}

/**
 * 计算单个分组的有效观测比例，并生成质量记录。
 */
async function group_frac_valid(
  col: eeCollection,
  group: Group,
  options: FilterOptions,
): Promise<QualityRecord> {
  const source = col.filter(ee.Filter.inList(
    options.indexProperty || 'system:index',
    group.indices,
  ));
  const mosaic = options.buildImage(source, options.buildImageOptions);
  const quality = Number(await util.evaluate(
    image_frac_valid(mosaic, options.qualityOptions),
  ));

  return {
    group_key: group.key,
    filename: group.name + (options.extension || '.tif'),
    source_count: group.indices.length,
    frac_valid: Number.isFinite(quality)
      ? Number(quality.toFixed(6))
      : 0,
  };
}

/**
 * 复用质量缓存，评估缺失分组并筛选达到阈值的分组。
 */
async function col_frac_valid(
  col: eeCollection, groups: Group[], options: FilterOptions,
): Promise<Group[]> {
  const allFile = path.join(options.outdir, options.prefix + 'all.csv');
  const selectedFile = path.join(options.outdir, options.prefix + 'selected.csv');
  const records = readCsv(allFile);
  const step = options.concurrency || 4;

  for (let i = 0; i < groups.length; i += step) {
    const pending = groups.slice(i, i + step)
      .filter((group) => !records.has(group.key));                  // 尚未进入缓存的分组
    if (!pending.length) continue;

    const batch = await Promise.all(
      pending.map((group) => group_frac_valid(col, group, options)) // 主要耗时点
    );
    batch.forEach((record) => {
      records.set(record.group_key, record);
      console.log('[quality] ' + record.group_key + ': ' +
        record.frac_valid.toFixed(6));
    });
    appendCsv(allFile, batch);
  }

  const collect = Array.from(records.values());
  const selected = collect.filter((record) =>
    record.frac_valid >= options.qualityOptions.minQuality);
  writeCsv(selectedFile, selected);

  const selected_keys = new Set(selected.map((record) => record.group_key));
  return groups.filter((group) => selected_keys.has(group.key));
}

export = col_frac_valid;

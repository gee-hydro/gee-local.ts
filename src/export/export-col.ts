import { exportTaskInfo } from './taskInfo.js';
import {
  evaluate,
  log,
  mapConcurrent,
  parsePeriod,
  splitGroups,
  type Group,
} from './utilize.js';

export { export_img, getDownloadParams } from './export-image.js';
export type { Group };

export type Collection = {
  aggregate_array(property: string): unknown;
  size(): unknown;
};

export type GroupOptions = {
  prefix?: string;
  suffixPattern?: RegExp;
  maxGroups?: number;
  period?: string;
  groups?: Group[];
  indexProperty?: string;
  timeProperty?: string;
};

type SceneRecord = {
  filename: string;
  properties: string[];
};

export type ExportOptions = GroupOptions & {
  concurrency?: number;
  exportImage: (group: Group) => unknown;
  sceneRecord?: SceneRecord;
  log?: false | ((message: string) => void);
};

export type TilingOptions = {
  bounds: [number, number, number, number];
  dimensions: [number, number];
  rows?: number;
  cols?: number;
  crs?: string;
  concurrency?: number;
  resampling?: string;
  srcNoData?: number;
  dstNoData?: number;
  dataType?: string;
};

export type DownloadOptions = {
  outdir: string;
  region?: unknown;
  format?: string;
  filePerBand?: boolean;
  scale?: number;
  cellsize?: number;
  crs?: string;
  crsTransform?: number[];
  retries?: number;
  tiling?: TilingOptions;
  fetch?: typeof fetch;
  log?: false | ((message: string) => void);
};

export async function listGroups(
  collection: Collection,
  options: GroupOptions,
): Promise<Group[]> {
  const maxGroups = Number(options.maxGroups ?? -1);
  if (!Number.isInteger(maxGroups) || maxGroups < -1) {
    throw new Error('maxGroups 须为 -1 或非负整数');
  }

  let groups = options.groups;
  if (groups == null) {
    const period = parsePeriod(options.period);
    const [indices, timestamps] = await Promise.all([
      evaluate<string[]>(collection.aggregate_array(
        options.indexProperty ?? 'system:index',
      )),
      evaluate<Array<number | string>>(collection.aggregate_array(
        options.timeProperty ?? 'system:time_start',
      )),
    ]);
    groups = splitGroups(
      indices,
      timestamps,
      period,
      options.prefix,
      options.suffixPattern,
    );
  }
  return maxGroups < 0 ? groups : groups.slice(0, maxGroups);
}

async function exportCollection(
  collection: Collection,
  options: ExportOptions,
): Promise<void> {
  const concurrency = Number(options.concurrency ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency 须为正整数');
  }

  const groups = await listGroups(collection, options);
  if (options.sceneRecord) {
    await exportTaskInfo(
      collection,
      options.sceneRecord.filename,
      options.sceneRecord.properties,
      options.log === false ? null : options.log ?? console.log,
    );
  }

  log(options, '时段数：' + groups.length + '；并发：'
    + Math.min(concurrency, groups.length));
  await mapConcurrent(groups, concurrency, options.exportImage);
  log(options, '下载完成');
}

export function export_col(
  collection: Collection,
  options: ExportOptions,
): Promise<void> {
  return exportCollection(collection, options);
}

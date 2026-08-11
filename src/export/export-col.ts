import type { ee } from '../ee';
import { exportTaskInfo } from './taskInfo';
import {
  evaluate,
  log,
  mapConcurrent,
  parsePeriod,
  splitGroups,
  type Group,
} from './utilize';

export { export_img, export_img_grids } from './export-img';
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
  dimensions?: [number, number];
  /** @deprecated 使用顶层 DownloadOptions.crs。 */
  crs?: string;
  rows?: number;
  cols?: number;
  concurrency?: number;
  resampling?: string;
  srcNoData?: number;
  dstNoData?: number;
  dataType?: string;
};

export type DownloadOptions = {
  outdir: string;
  /** [xmin, ymin, xmax, ymax]；有 bounds 时自动 region=Rectangle(bounds) */
  bounds?: [number, number, number, number];
  /** 非矩形裁剪时用；默认由 bounds 生成 */
  region?: ee.Geometry;
  format?: string;
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

export async function export_col(
  collection: Collection,
  options: ExportOptions
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

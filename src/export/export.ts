import * as task_info from './taskInfo.js';
import * as util from './utilize.js';
import { runtime } from '../local/runtime.js';
import { export_img, getDownloadParams } from './export-image.js';

export { export_img, getDownloadParams };

export type Group = {
  key: string;
  name: string;
  indices: string[];
};

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

export type ExportOptions = {
  groups?: Group[];
  concurrency?: number;
  exportImage: (group: Group) => unknown;
  sceneRecord?: SceneRecord;
  log?: false | ((message: string) => void);
};

export type DownloadOptions = {
  outdir: string;
  region?: unknown;
  format?: string;
  filePerBand?: boolean;
  retries?: number;
  tiling?: Record<string, unknown>;
  fetch?: typeof fetch;
  log?: false | ((message: string) => void);
};

export async function listGroups(
  col: Collection,
  options: GroupOptions,
): Promise<Group[]> {
  const max_groups = options.maxGroups == null ? -1 : Number(options.maxGroups);
  if (!Number.isInteger(max_groups) || max_groups < -1) {
    throw new Error('maxGroups 须为 -1 或非负整数');
  }

  let groups = options.groups;
  if (!groups) {
    const period = util.parsePeriod(options.period || '1d');
    const values = await Promise.all([
      util.evaluate<string[]>(col.aggregate_array(
        options.indexProperty || 'system:index',
      )),
      util.evaluate<Array<number | string>>(col.aggregate_array(
        options.timeProperty || 'system:time_start',
      )),
    ]);
    groups = util.split_group(
      values[0],
      values[1],
      period,
      options.prefix,
      options.suffixPattern,
    ) as Group[];
  }
  return max_groups < 0 ? groups : groups.slice(0, max_groups);
}

async function run_concurrent(
  items: Group[],
  concurrency: number,
  task: (item: Group) => Promise<unknown>,
): Promise<void> {
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor];
      cursor += 1;
      await task(item);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  ));
}

async function export_collection(
  col: Collection,
  options: ExportOptions,
): Promise<void> {
  const concurrency = options.concurrency == null ? 4 : Number(options.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency 须为正整数');
  }

  const groups = options.groups || await listGroups(col, options as GroupOptions);
  if (options.sceneRecord) {
    await task_info.export_taskInfo(
      col,
      options.sceneRecord.filename,
      options.sceneRecord.properties,
      options.log === false ? null : options.log || console.log,
    );
  }

  util.log(options, '时段数：' + groups.length + '；并发：' +
    Math.min(concurrency, groups.length));
  await run_concurrent(groups, concurrency, (group) =>
    Promise.resolve(options.exportImage(group)));
  util.log(options, '下载完成');
}

export function export_col(
  col: Collection,
  options: ExportOptions,
): Promise<void> {
  const host = runtime()._host;
  runtime().print?.('原始影像数：', col.size());

  const promise = export_collection(col, options);
  if (!host) return promise;

  const registered = promise.catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('下载失败：' + message);
    process.exitCode = 1;
    throw error;
  });
  host.pendingPrints.push(registered);
  return registered;
}

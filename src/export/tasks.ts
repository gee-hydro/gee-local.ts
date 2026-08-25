/**
 * GEE 异步 batch 导出：先全部提交，再轮询进度。
 * local → exportBatches；drive/gcs → 本模块。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { validateCacheBounds, type CacheBounds } from './bounds';
import { ee } from '../ee';
import { frameCollection } from './frame-collection';
import type { GeeDailyReduction, GeeTemporal } from '../types';
import {
  dailyBuckets,
  estimateFrameCount,
  makeCacheId,
  nativeBuckets,
  normalizeFrameImage,
  regionGeometry,
  type Bucket,
  type BuildFrameFn,
} from './batches';

export type TaskDestination = 'drive' | 'gcs';

export type RemoteTaskState =
  | 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED'
  | 'CANCELLED' | 'CANCEL_REQUESTED' | 'UNKNOWN' | 'SUBMITTED';

export interface SubmitExportTasksOptions {
  collection: string;
  band: string;
  scale: number;
  crs?: string;
  bounds: CacheBounds;
  start: string;
  end: string;
  temporal: GeeTemporal;
  stepHours?: number;
  reduction?: GeeDailyReduction;
  bucket: Bucket;
  destination: TaskDestination;
  driveFolder?: string;
  gcsBucket?: string;
  fileNamePrefix?: string;
  maxPixels?: number;
  buildFrame?: BuildFrameFn;
  jobDir?: string;
  descriptionPrefix?: string;
  dryRun?: boolean;
  onSubmit?: (info: TaskRecord) => void;
}

export interface TaskRecord {
  index: number;
  total: number;
  taskId: string;
  description: string;
  cacheId: string;
  bucketStart: string;
  bucketEnd: string;
  framesCount: number;
  fileNamePrefix: string;
  destination: TaskDestination;
  driveFolder?: string;
  gcsBucket?: string;
  state: RemoteTaskState;
  error?: string;
  submittedAt: string;
  updatedAt?: string;
}

export interface ExportJob {
  jobId: string;
  createdAt: string;
  updatedAt: string;
  options: {
    collection: string;
    band: string;
    scale: number;
    crs: string;
    bounds: CacheBounds;
    start: string;
    end: string;
    temporal: GeeTemporal;
    stepHours?: number;
    bucket: Bucket;
    destination: TaskDestination;
    driveFolder?: string;
    gcsBucket?: string;
    fileNamePrefix: string;
    maxPixels: number;
  };
  tasks: TaskRecord[];
}

export interface TaskStatusView {
  taskId: string;
  state: RemoteTaskState;
  description?: string;
  creationTimestamp?: number | string;
  startTimestamp?: number | string;
  updateTimestamp?: number | string;
  errorMessage?: string;
  destinationUris?: string[];
  raw?: unknown;
}

const DEFAULT_CRS = 'EPSG:4326';
const DEFAULT_JOB_DIR = path.resolve(process.cwd(), 'cache/gee-export-jobs');
const DEFAULT_MAX_PIXELS = 1e13;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asAny(v: unknown): any { return v as any; }

function nowIso(): string { return new Date().toISOString(); }

function shortId(): string {
  return createHash('sha1').update(`${Date.now()}-${Math.random()}`).digest('hex').slice(0, 10);
}

function sanitizeName(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/_+/g, '_').slice(0, 80);
}

function taskCacheId(opts: {
  collection: string; band: string; scale: number; crs: string;
  temporal: GeeTemporal; stepHours?: number; reduction?: GeeDailyReduction;
  bucket: Bucket; bounds: CacheBounds;
}, bucketStart: string, bucketEnd: string): string {
  return makeCacheId(
    `batch-task|${opts.collection}|${opts.band}|${opts.scale}|${opts.crs}|${opts.temporal}|${opts.stepHours ?? ''}|${opts.reduction ?? ''}|${bucketStart}|${bucketEnd}|${opts.bucket}|${JSON.stringify(opts.bounds)}`,
  );
}

function startTaskAsync(task: { id: string | null; start: Function }): Promise<string> {
  return new Promise((resolve, reject) => {
    task.start(
      () => (task.id ? resolve(task.id) : reject(new Error('task.start 成功但无 taskId'))),
      (err: unknown) => reject(err instanceof Error ? err : new Error(String(err))),
    );
  });
}

function normalizeState(s: unknown): RemoteTaskState {
  const u = String(s ?? 'UNKNOWN').toUpperCase();
  if (u === 'SUCCEEDED' || u === 'SUCCESS') return 'COMPLETED';
  if (u === 'CANCELLING') return 'CANCEL_REQUESTED';
  if (
    u === 'READY' || u === 'RUNNING' || u === 'COMPLETED' || u === 'FAILED'
    || u === 'CANCELLED' || u === 'CANCEL_REQUESTED' || u === 'SUBMITTED'
  ) return u;
  return 'UNKNOWN';
}

function jobPath(jobDir: string, jobId: string): string {
  return path.join(jobDir, `${jobId}.json`);
}

export function saveJob(job: ExportJob, jobDir = DEFAULT_JOB_DIR): string {
  fs.mkdirSync(jobDir, { recursive: true });
  const p = jobPath(jobDir, job.jobId);
  fs.writeFileSync(p, `${JSON.stringify(job, null, 2)}\n`);
  return p;
}

export function loadJob(jobId: string, jobDir = DEFAULT_JOB_DIR): ExportJob {
  const p = jobPath(jobDir, jobId);
  if (!fs.existsSync(p)) throw new Error(`job 不存在: ${p}`);
  return JSON.parse(fs.readFileSync(p, 'utf8')) as ExportJob;
}

export function listJobs(jobDir = DEFAULT_JOB_DIR): string[] {
  if (!fs.existsSync(jobDir)) return [];
  return fs.readdirSync(jobDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace(/\.json$/, ''))
    .sort();
}

export async function getTaskStatuses(taskIds: string[]): Promise<TaskStatusView[]> {
  if (taskIds.length === 0) return [];
  await ee.Initialize();
  return new Promise((resolve, reject) => {
    asAny(ee).data.getTaskStatus(taskIds, (result: unknown[] | null, err?: string) => {
      if (err) { reject(new Error(String(err))); return; }
      resolve((result ?? []).map((raw) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = raw as any;
        return {
          taskId: String(r?.id ?? r?.name ?? ''),
          state: normalizeState(r?.state ?? r?.metadata?.state),
          description: r?.description ?? r?.metadata?.description,
          creationTimestamp: r?.creation_timestamp_ms ?? r?.createTime,
          startTimestamp: r?.start_timestamp_ms ?? r?.startTime,
          updateTimestamp: r?.update_timestamp_ms ?? r?.updateTime,
          errorMessage: r?.error_message ?? r?.error?.message,
          destinationUris: r?.destination_uris ?? r?.metadata?.destinationUris,
          raw,
        } satisfies TaskStatusView;
      }));
    });
  });
}

export async function listRecentOperations(limit = 20): Promise<TaskStatusView[]> {
  await ee.Initialize();
  return new Promise((resolve, reject) => {
    asAny(ee).data.listOperations(limit, (ops: unknown[] | null, err?: string) => {
      if (err) { reject(new Error(String(err))); return; }
      resolve((ops ?? []).map((raw) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = raw as any;
        const meta = r?.metadata ?? {};
        const name: string = r?.name ?? '';
        const taskId = name.includes('/operations/')
          ? name.split('/operations/').pop()!
          : (r?.id ?? name);
        let state: RemoteTaskState = 'UNKNOWN';
        if (r?.done) state = r?.error ? 'FAILED' : 'COMPLETED';
        else if (meta.state) state = normalizeState(meta.state);
        else state = 'RUNNING';
        return {
          taskId: String(taskId),
          state,
          description: meta.description ?? meta.scriptUri,
          creationTimestamp: meta.createTime ?? r?.createTime,
          updateTimestamp: meta.updateTime ?? r?.updateTime,
          errorMessage: r?.error?.message,
          raw,
        } satisfies TaskStatusView;
      }));
    });
  });
}

export async function cancelTasks(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await ee.Initialize();
  await Promise.all(taskIds.map((id) => new Promise<void>((resolve, reject) => {
    asAny(ee).data.cancelTask(id, (_: unknown, err?: string) => {
      if (err) reject(new Error(String(err)));
      else resolve();
    });
  })));
}

export async function refreshJob(jobId: string, jobDir = DEFAULT_JOB_DIR): Promise<ExportJob> {
  const job = loadJob(jobId, jobDir);
  const ids = job.tasks.map((t) => t.taskId).filter(Boolean);
  if (ids.length === 0) return job;
  const statuses = await getTaskStatuses(ids);
  const byId = new Map(statuses.map((s) => [s.taskId, s]));
  const updatedAt = nowIso();
  job.tasks = job.tasks.map((t) => {
    const s = byId.get(t.taskId);
    if (!s) return t;
    return { ...t, state: s.state, error: s.errorMessage, updatedAt };
  });
  job.updatedAt = updatedAt;
  saveJob(job, jobDir);
  return job;
}

export async function submitExportTasks(
  opts: SubmitExportTasksOptions,
): Promise<{ jobId: string; jobPath: string; tasks: TaskRecord[]; dryRun: boolean }> {
  const bounds = validateCacheBounds(opts.bounds);
  const crs = opts.crs ?? DEFAULT_CRS;
  if (opts.temporal === 'native' && (!opts.stepHours || opts.stepHours <= 0)) {
    throw new Error('temporal=native 时须指定 stepHours');
  }
  if (opts.destination === 'gcs' && !opts.gcsBucket) {
    throw new Error('destination=gcs 时须指定 gcsBucket');
  }

  const buckets = opts.temporal === 'native'
    ? nativeBuckets(opts.start, opts.end, opts.stepHours!, opts.bucket)
    : dailyBuckets(opts.start, opts.end, opts.bucket);
  if (buckets.length === 0) throw new Error('空桶序列');

  const fileNamePrefix = opts.fileNamePrefix
    ?? sanitizeName(`${opts.collection.replace(/\//g, '_')}_${opts.band}`);
  const maxPixels = opts.maxPixels ?? DEFAULT_MAX_PIXELS;
  const jobDir = opts.jobDir ?? DEFAULT_JOB_DIR;
  const jobId = `job_${shortId()}`;
  const descPrefix = opts.descriptionPrefix ?? `ee_${jobId}`;
  const createdAt = nowIso();
  const dryRun = !!opts.dryRun;
  const driveFolder = opts.destination === 'drive'
    ? (opts.driveFolder ?? 'gee-exports')
    : opts.driveFolder;

  const baseOpts = {
    collection: opts.collection,
    band: opts.band,
    scale: opts.scale,
    crs,
    temporal: opts.temporal,
    stepHours: opts.stepHours,
    reduction: opts.reduction,
    bucket: opts.bucket,
    bounds,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Export: any;
  if (!dryRun) {
    await ee.Initialize();
    Export = asAny(ee).batch?.Export ?? asAny(ee).Export;
    if (!Export?.image?.toDrive) {
      throw new Error('ee.batch.Export.image 不可用，请检查 @google/earthengine 版本');
    }
  }

  const region = regionGeometry(bounds);
  const tasks: TaskRecord[] = [];

  for (let i = 0; i < buckets.length; i++) {
    const [bs, be] = buckets[i]!;
    const cacheId = taskCacheId(baseOpts, bs, be);
    const framesCount = estimateFrameCount(bs, be, opts.temporal, opts.stepHours);
    const description = sanitizeName(`${descPrefix}_${i + 1}_${bs}_${be}`);
    const prefix = `${fileNamePrefix}_${cacheId}`;

    let taskId = '';
    let state: RemoteTaskState = 'SUBMITTED';

    if (!dryRun) {
      const col = opts.buildFrame
        ? opts.buildFrame({
            collection: opts.collection, band: opts.band,
            start: bs, end: be, stepHours: opts.stepHours, bounds,
          })
        : frameCollection(
            opts.collection, opts.band, bs, be,
            opts.temporal, opts.stepHours, opts.reduction,
          );
      const image = normalizeFrameImage(col);
      const common = {
        image, description, region, scale: opts.scale, crs, maxPixels,
        fileNamePrefix: prefix, fileFormat: 'GeoTIFF',
      };
      const task = opts.destination === 'gcs'
        ? Export.image.toCloudStorage({ ...common, bucket: opts.gcsBucket })
        : Export.image.toDrive({ ...common, folder: driveFolder });
      taskId = await startTaskAsync(task);
      state = 'READY';
    }

    const rec: TaskRecord = {
      index: i + 1,
      total: buckets.length,
      taskId,
      description,
      cacheId,
      bucketStart: bs,
      bucketEnd: be,
      framesCount,
      fileNamePrefix: prefix,
      destination: opts.destination,
      driveFolder,
      gcsBucket: opts.gcsBucket,
      state,
      submittedAt: nowIso(),
    };
    tasks.push(rec);
    opts.onSubmit?.(rec);
  }

  const job: ExportJob = {
    jobId,
    createdAt,
    updatedAt: nowIso(),
    options: {
      ...baseOpts,
      start: opts.start,
      end: opts.end,
      destination: opts.destination,
      driveFolder,
      gcsBucket: opts.gcsBucket,
      fileNamePrefix,
      maxPixels,
    },
    tasks,
  };
  return { jobId, jobPath: saveJob(job, jobDir), tasks, dryRun };
}

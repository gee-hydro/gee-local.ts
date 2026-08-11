/**
 * 通用 GEE 批量导出：任意 collection → 多桶 multi-band GeoTIFF（getDownloadURL 同步）。
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { ensureReady } from '../auth';
import type { ee } from '../ee';
import type { GeeDailyReduction, GeeTemporal } from '../types';
import { validateCacheBounds, type CacheBounds } from './bounds';
import { frameCollection } from './frame-collection';

export type Bucket = 'day' | 'week' | 'month' | 'range';

export interface BuildFrameParams {
  collection: string;
  band: string;
  start: string;
  end: string;
  stepHours?: number;
  bounds: CacheBounds;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type BuildFrameFn = (params: BuildFrameParams) => any;

export interface ExportBatchesOptions {
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
  cacheDir?: string;
  concurrency?: number;
  onBatch?: (info: BatchInfo) => void;
  buildFrame?: BuildFrameFn;
}

export interface BatchInfo {
  index: number;
  total: number;
  bucketStart: string;
  bucketEnd: string;
  framesCount: number;
  cacheId: string;
  file: string;
  bytes: number;
  durationMs: number;
  status: 'ok' | 'skip' | 'fail';
  error?: string;
}

const DEFAULT_CACHE_DIR = path.resolve(process.cwd(), 'cache/gee-batches');
const DEFAULT_CRS = 'EPSG:4326';
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function makeCacheId(payload: string): string {
  return createHash('sha256').update(payload).digest('hex').slice(0, 20);
}

export function regionGeometry(bounds: CacheBounds): {
  type: 'Polygon';
  coordinates: number[][][];
} {
  return {
    type: 'Polygon',
    coordinates: [[
      [bounds.west, bounds.south],
      [bounds.east, bounds.south],
      [bounds.east, bounds.north],
      [bounds.west, bounds.north],
      [bounds.west, bounds.south],
    ]],
  };
}

export function normalizeFrameImage(
  frame: ee.Image | ee.ImageCollection,
): ee.Image {
  const col = frame as { toBands?: () => ee.Image };
  return typeof col.toBands === 'function' ? col.toBands() : frame as ee.Image;
}

function toIsoCompact(iso: string): string {
  return iso.replace(/\.000Z$/, 'Z');
}

function isoDay(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

function isoCompactMs(t: number): string {
  return toIsoCompact(new Date(t).toISOString());
}

function assertIsoDate(v: string, label: string): string {
  if (!ISO_DATE_RE.test(v)) throw new Error(`${label} 须为 YYYY-MM-DD: ${v}`);
  return v;
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function utcMonday(t: number): number {
  return t - ((new Date(t).getUTCDay() + 6) % 7) * 864e5;
}

function eachMonth(start: string, end: string, fn: (y: number, m: number) => void): void {
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ey = Number(end.slice(0, 4));
  const em = Number(end.slice(5, 7));
  while (y < ey || (y === ey && m <= em)) {
    fn(y, m);
    m++; if (m > 12) { m = 1; y++; }
  }
}

export function estimateFrameCount(
  start: string, end: string, temporal: GeeTemporal, stepHours?: number,
): number {
  if (temporal === 'native') {
    const stepMs = (stepHours ?? 1) * 3600e3;
    return Math.floor((Date.parse(end) - Date.parse(start)) / stepMs) + 1;
  }
  const t0 = Date.parse(`${start.slice(0, 10)}T00:00:00Z`);
  const t1 = Date.parse(`${end.slice(0, 10)}T00:00:00Z`);
  return Math.round((t1 - t0) / 864e5) + 1;
}

export function dailyBuckets(start: string, end: string, mode: Bucket): Array<[string, string]> {
  assertIsoDate(start, 'start'); assertIsoDate(end, 'end');
  if (start > end) throw new Error('start 须 ≤ end');
  if (mode === 'range') return [[start, end]];

  const buckets: Array<[string, string]> = [];
  const tStart = Date.parse(`${start}T00:00:00Z`);
  const tEnd = Date.parse(`${end}T00:00:00Z`);

  if (mode === 'day') {
    for (let t = tStart; t <= tEnd; t += 864e5) buckets.push([isoDay(t), isoDay(t)]);
    return buckets;
  }

  if (mode === 'week') {
    for (let cursor = utcMonday(tStart); cursor <= tEnd; cursor += 7 * 864e5) {
      const bStart = Math.max(cursor, tStart);
      const bEnd = Math.min(cursor + 6 * 864e5, tEnd);
      buckets.push([isoDay(bStart), isoDay(bEnd)]);
    }
    return buckets;
  }

  eachMonth(start, end, (y, m) => {
    const mm = String(m).padStart(2, '0');
    const first = `${y}-${mm}-01`;
    const last = `${y}-${mm}-${daysInMonth(y, m)}`;
    buckets.push([first > start ? first : start, last < end ? last : end]);
  });
  return buckets;
}

export function nativeBuckets(
  start: string, end: string, stepHours: number, mode: Bucket,
): Array<[string, string]> {
  if (stepHours <= 0 || stepHours > 24) throw new Error(`stepHours 须 (0,24]: ${stepHours}`);
  const tStart = Date.parse(start);
  const tEnd = Date.parse(end);
  if (!Number.isFinite(tStart) || !Number.isFinite(tEnd) || tStart > tEnd) {
    throw new Error('start/end 非法或 start>end');
  }
  const lastFrameOfDay = (t: number) => t + (24 - stepHours) * 3600e3;
  const pair = (a: number, b: number): [string, string] => [isoCompactMs(a), isoCompactMs(b)];

  if (mode === 'range') return [pair(tStart, tEnd)];

  const out: Array<[string, string]> = [];
  if (mode === 'day') {
    for (let d = tStart; d <= tEnd; d += 864e5) {
      out.push(pair(d, Math.min(lastFrameOfDay(d), tEnd)));
    }
    return out;
  }

  if (mode === 'week') {
    for (let cursor = utcMonday(tStart); cursor <= tEnd; cursor += 7 * 864e5) {
      const bStart = Math.max(cursor, tStart);
      const bEnd = Math.min(lastFrameOfDay(cursor + 6 * 864e5), tEnd);
      if (bStart <= bEnd) out.push(pair(bStart, bEnd));
    }
    return out;
  }

  eachMonth(start, end, (y, m) => {
    const first = Date.UTC(y, m - 1, 1);
    const last = Date.UTC(y, m - 1, daysInMonth(y, m));
    const bStart = Math.max(first, tStart);
    const bEnd = Math.min(lastFrameOfDay(last), tEnd);
    if (bStart <= bEnd) out.push(pair(bStart, bEnd));
  });
  return out;
}

function bucketCacheId(opts: ExportBatchesOptions, bucketStart: string, bucketEnd: string): string {
  return makeCacheId(
    `batch|${opts.collection}|${opts.band}|${opts.scale}|${opts.crs}|${opts.temporal}|${opts.stepHours ?? ''}|${opts.reduction ?? ''}|${bucketStart}|${bucketEnd}|${opts.bucket}|${JSON.stringify(opts.bounds)}`,
  );
}

async function downloadUrl(opts: ExportBatchesOptions, start: string, end: string): Promise<string> {
  await ensureReady();
  const frame = opts.buildFrame
    ? opts.buildFrame({
        collection: opts.collection, band: opts.band,
        start, end, stepHours: opts.stepHours, bounds: opts.bounds,
      })
    : frameCollection(
        opts.collection, opts.band, start, end,
        opts.temporal, opts.stepHours, opts.reduction,
      );
  const image = normalizeFrameImage(frame);
  return new Promise((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (image as any).getDownloadURL({
      name: `${opts.collection.replace(/\//g, '_')}_${opts.band}_${start}_${end}`,
      region: regionGeometry(opts.bounds),
      scale: opts.scale,
      crs: opts.crs,
      format: 'GEO_TIFF',
    }, (url: string | null, error?: string) => {
      if (!url) reject(new Error(`GeoTIFF 下载地址生成失败: ${error ?? 'empty'}`));
      else resolve(url);
    });
  });
}

interface Manifest {
  cacheId: string;
  mode: 'batch';
  collection: string;
  band: string;
  temporal: GeeTemporal;
  stepHours?: number;
  bucket: Bucket;
  bounds: CacheBounds;
  scale: number;
  crs: string;
  bucketStart: string;
  bucketEnd: string;
  framesCount: number;
  bytes: number;
  file: string;
}

async function processBucket(
  opts: ExportBatchesOptions, cacheDir: string,
  index: number, total: number,
  bucketStart: string, bucketEnd: string,
): Promise<BatchInfo> {
  const cacheId = bucketCacheId(opts, bucketStart, bucketEnd);
  const tifPath = path.join(cacheDir, `${cacheId}.tif`);
  const manifestPath = path.join(cacheDir, `${cacheId}.json`);
  const framesCount = estimateFrameCount(bucketStart, bucketEnd, opts.temporal, opts.stepHours);
  const base = {
    index, total, bucketStart, bucketEnd, framesCount, cacheId,
    file: path.basename(tifPath),
  };
  const t0 = Date.now();

  if (fs.existsSync(tifPath) && fs.existsSync(manifestPath)) {
    const stat = await fs.promises.stat(tifPath);
    return { ...base, bytes: stat.size, durationMs: 0, status: 'skip' };
  }

  await fs.promises.mkdir(cacheDir, { recursive: true });
  const tmp = `${tifPath}.${process.pid}.tmp`;
  try {
    const url = await downloadUrl(opts, bucketStart, bucketEnd);
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`GeoTIFF 下载失败: HTTP ${resp.status}`);
    const buf = Buffer.from(await resp.arrayBuffer());
    if (buf.length < 1024) throw new Error('GeoTIFF 下载结果异常（文件过小）');
    await fs.promises.writeFile(tmp, buf);
    await fs.promises.rename(tmp, tifPath);

    const manifest: Manifest = {
      cacheId, mode: 'batch',
      collection: opts.collection, band: opts.band,
      temporal: opts.temporal, stepHours: opts.stepHours,
      bucket: opts.bucket, bounds: opts.bounds,
      scale: opts.scale, crs: opts.crs ?? DEFAULT_CRS,
      bucketStart, bucketEnd, framesCount,
      bytes: buf.length, file: path.basename(tifPath),
    };
    await fs.promises.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    return { ...base, bytes: buf.length, durationMs: Date.now() - t0, status: 'ok' };
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    return {
      ...base, bytes: 0, durationMs: Date.now() - t0, status: 'fail',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

class Sem {
  private active = 0;
  private queue: Array<() => void> = [];
  constructor(private readonly permits: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.permits) await new Promise<void>((r) => this.queue.push(r));
    this.active++;
    try { return await fn(); }
    finally {
      this.active--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

export async function exportBatches(opts: ExportBatchesOptions): Promise<BatchInfo[]> {
  const o: ExportBatchesOptions = {
    ...opts,
    bounds: validateCacheBounds(opts.bounds),
    crs: opts.crs ?? DEFAULT_CRS,
  };
  if (o.temporal === 'native' && (!o.stepHours || o.stepHours <= 0)) {
    throw new Error('temporal=native 时须指定 stepHours');
  }
  const cacheDir = o.cacheDir ?? process.env.GEE_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  const buckets = o.temporal === 'native'
    ? nativeBuckets(o.start, o.end, o.stepHours!, o.bucket)
    : dailyBuckets(o.start, o.end, o.bucket);
  if (buckets.length === 0) throw new Error('空桶序列');

  const sem = new Sem(Math.max(1, o.concurrency ?? 1));
  return Promise.all(buckets.map(([bs, be], i) => sem.run(async () => {
    const info = await processBucket(o, cacheDir, i + 1, buckets.length, bs, be);
    o.onBatch?.(info);
    return info;
  })));
}

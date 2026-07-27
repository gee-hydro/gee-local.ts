/**
 * 本地数据面：catalog + 日期/范围筛选；
 * 栅格处理走 Julia（统一 apply(ra::SpatRaster; params...)）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CacheBounds } from '../export/bounds';
import {
  defaultCatalogPath,
  scanLocalCatalog,
  scanLocalSources,
} from './catalog';
import { filterFrames } from './query';
import {
  getJuliaWorker,
  type JuliaApplyResult,
} from './julia-worker';
import { getLocalOp, listLocalOps, registerLocalOp, runLocalOp } from './ops';
import type { LocalFrame, LocalQuery } from './types';

export {
  dateOverlaps, boundsOverlaps, filterFrames, toDay,
} from './query';
export {
  defaultCatalogPath,
  datasetToFrames,
  guessFormat,
  loadCatalog,
  scanLocalCatalog,
  scanLocalSources,
  scanSidecarDir,
} from './catalog';
export {
  inspectLocal,
  listDatasets,
  registerLocal,
  unregisterLocal,
  type InspectResult,
  type RegisterLocalOptions,
} from './register';
export {
  registerLocalOp, getLocalOp, listLocalOps, runLocalOp,
} from './ops';
export { JuliaWorker, getJuliaWorker } from './julia-worker';
export type {
  JuliaApplyPayload, JuliaApplyResult, JuliaCropResult, JuliaInfoResult,
  JuliaInspectResult,
} from './julia-worker';
export type {
  LocalCatalogFile, LocalDataset, LocalFormat,
  LocalFrame, LocalQuery, LocalOp, LocalOpName, LocalOpContext,
} from './types';

/** 扫描注册表/sidecar + 筛选 */
export function queryLocal(q: LocalQuery): LocalFrame[] {
  const frames = scanLocalSources({
    catalog: q.catalog,
    root: q.root,
    datasetId: q.datasetId,
  });
  return filterFrames(frames, q);
}

export interface CropLocalOptions extends LocalQuery {
  bounds: CacheBounds;
  outDir: string;
}

export interface CropLocalResult {
  frame: LocalFrame;
  out: string;
  bbox: CacheBounds;
}

/** 日期+范围筛选后，用 SpatialRasterLite st_crop 写出 */
export async function cropLocal(opts: CropLocalOptions): Promise<CropLocalResult[]> {
  const frames = queryLocal(opts);
  if (frames.length === 0) return [];

  const outDir = path.resolve(opts.outDir);
  await fs.promises.mkdir(outDir, { recursive: true });
  const worker = getJuliaWorker();
  const results: CropLocalResult[] = [];

  for (const frame of frames) {
    const out = path.join(outDir, `${frame.id.replace(/[/:]/g, '_')}_crop.tif`);
    const r = await worker.crop(frame.path, opts.bounds, out, frame.band ?? opts.band);
    results.push({ frame, out: r.out, bbox: r.bbox });
  }
  return results;
}

/** stack=多时相拼 3D 一次调用；each=逐景 2D 调用 */
export type ApplyMode = 'stack' | 'each';

export interface ApplyLocalOptions extends LocalQuery {
  /** Julia 文件路径，内含 apply(ra; params...) */
  fn: string;
  fnName?: string;
  params?: Record<string, unknown>;
  /** stack 默认；多景 3D / 单景保持原维 */
  mode?: ApplyMode;
  /** 栅格结果输出：stack → 单文件；each → 目录 */
  out?: string;
  outDir?: string;
}

export interface ApplyLocalItem {
  frames: LocalFrame[];
  result: JuliaApplyResult;
}

/**
 * 筛选后调用用户 Julia 函数。
 * 统一签名：apply(ra::SpatRaster; params...)
 * - mode=stack：paths→(nx,ny,nt)
 * - mode=each：每景独立 2D/原维
 */
export async function applyLocal(opts: ApplyLocalOptions): Promise<ApplyLocalItem[]> {
  const frames = queryLocal(opts);
  if (frames.length === 0) return [];

  const fn = path.resolve(opts.fn);
  if (!fs.existsSync(fn)) throw new Error(`fn 不存在: ${fn}`);
  const mode: ApplyMode = opts.mode ?? 'stack';
  const worker = getJuliaWorker();
  const fnName = opts.fnName ?? 'apply';
  const params = opts.params;

  if (mode === 'stack') {
    let out = opts.out;
    if (!out && opts.outDir) {
      await fs.promises.mkdir(path.resolve(opts.outDir), { recursive: true });
      out = path.join(path.resolve(opts.outDir), 'apply_stack.tif');
    }
    // 单 nc 立方：stack 即时间维已在文件内，带 start/end 切片
    const onlyNc = frames.length === 1 && frames[0]!.format === 'nc';
    const result = await worker.apply({
      paths: frames.map((f) => f.path),
      times: onlyNc ? frames[0]!.times : frames.map((f) => f.start),
      bounds: opts.bounds,
      band: opts.band ?? frames[0]?.band,
      start: opts.start,
      end: opts.end,
      fnFile: fn,
      fnName,
      params,
      out,
    });
    return [{ frames, result }];
  }

  // each
  const outDir = opts.outDir ? path.resolve(opts.outDir) : undefined;
  if (outDir) await fs.promises.mkdir(outDir, { recursive: true });
  const items: ApplyLocalItem[] = [];
  for (const frame of frames) {
    const out = outDir
      ? path.join(outDir, `${frame.id.replace(/[/:]/g, '_')}_apply.tif`)
      : opts.out;
    const result = await worker.apply({
      paths: [frame.path],
      times: frame.times ?? [frame.start],
      bounds: opts.bounds,
      band: opts.band ?? frame.band,
      start: opts.start,
      end: opts.end,
      fnFile: fn,
      fnName,
      params,
      out,
    });
    items.push({ frames: [frame], result });
  }
  return items;
}

// 内置 op
registerLocalOp('crop', async (ctx) => {
  if (!ctx.bounds) throw new Error('crop 需要 bounds');
  if (!ctx.outDir) throw new Error('crop 需要 outDir');
  const worker = getJuliaWorker();
  await fs.promises.mkdir(ctx.outDir, { recursive: true });
  const out: CropLocalResult[] = [];
  for (const frame of ctx.frames) {
    const dest = path.join(ctx.outDir, `${frame.id}_crop.tif`);
    const r = await worker.crop(frame.path, ctx.bounds, dest);
    out.push({ frame, out: r.out, bbox: r.bbox });
  }
  return out;
});

registerLocalOp('apply', async (ctx) => {
  const fnRaw = ctx.params?.fn;
  if (typeof fnRaw !== 'string') throw new Error('apply op 需要 params.fn');
  const fn = path.resolve(fnRaw);
  if (!fs.existsSync(fn)) throw new Error(`fn 不存在: ${fn}`);
  if (ctx.frames.length === 0) return [];

  const mode: ApplyMode = ctx.params?.mode === 'each' ? 'each' : 'stack';
  const fnName = typeof ctx.params?.fnName === 'string' ? ctx.params.fnName : 'apply';
  const params = ctx.params?.params as Record<string, unknown> | undefined;
  const worker = getJuliaWorker();

  if (mode === 'stack') {
    let out = typeof ctx.params?.out === 'string' ? ctx.params.out : undefined;
    if (!out && ctx.outDir) {
      await fs.promises.mkdir(ctx.outDir, { recursive: true });
      out = path.join(ctx.outDir, 'apply_stack.tif');
    }
    const result = await worker.apply({
      paths: ctx.frames.map((f) => f.path),
      times: ctx.frames.map((f) => f.start),
      bounds: ctx.bounds,
      fnFile: fn,
      fnName,
      params,
      out,
    });
    return [{ frames: ctx.frames, result }] satisfies ApplyLocalItem[];
  }

  if (ctx.outDir) await fs.promises.mkdir(ctx.outDir, { recursive: true });
  const items: ApplyLocalItem[] = [];
  for (const frame of ctx.frames) {
    const out = ctx.outDir
      ? path.join(ctx.outDir, `${frame.id}_apply.tif`)
      : (typeof ctx.params?.out === 'string' ? ctx.params.out : undefined);
    const result = await worker.apply({
      paths: [frame.path],
      times: [frame.start],
      bounds: ctx.bounds,
      fnFile: fn,
      fnName,
      params,
      out,
    });
    items.push({ frames: [frame], result });
  }
  return items;
});

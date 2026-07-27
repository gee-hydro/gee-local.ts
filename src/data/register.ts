/**
 * 注册本地 tif / nc 到 catalog.json。
 * - tif：SpatialRasterLite（ArchGDAL）探元数据
 * - nc ：NCDatasets 读时空维 + 变量
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CacheBounds } from '../export/bounds';
import {
  defaultCatalogPath,
  guessFormat,
  loadCatalog,
  removeDataset,
  upsertDataset,
} from './catalog';
import { getJuliaWorker, type JuliaInspectResult } from './julia-worker';
import { toDay } from './query';
import type { LocalDataset, LocalFormat } from './types';

export interface RegisterLocalOptions {
  id: string;
  path: string;
  /** 默认按扩展名 / 目录推断 */
  format?: LocalFormat;
  band?: string;
  catalog?: string;
  /** 覆盖自动探测 */
  start?: string;
  end?: string;
  bounds?: CacheBounds;
  collection?: string;
  crs?: string;
  scale?: number;
}

export type InspectResult = JuliaInspectResult;

const DAY_IN_NAME = /(\d{4}-\d{2}-\d{2})/;

function dayFromName(file: string): string | undefined {
  const m = DAY_IN_NAME.exec(path.basename(file));
  return m?.[1];
}

/** exportBatches sidecar：同名 .json */
function sidecarDates(tifPath: string): {
  start?: string;
  end?: string;
  bounds?: CacheBounds;
  band?: string;
} | null {
  const side = tifPath.replace(/\.tiff?$/i, '.json');
  if (!fs.existsSync(side)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(side, 'utf8')) as Record<string, unknown>;
    const start = (raw.bucketStart ?? raw.start) as string | undefined;
    const end = (raw.bucketEnd ?? raw.end) as string | undefined;
    const bounds = raw.bounds as CacheBounds | undefined;
    const band = raw.band as string | undefined;
    return { start, end, bounds, band };
  } catch {
    return null;
  }
}

function listTifFiles(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const d = stack.pop()!;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === '.git' || ent.name === 'node_modules') continue;
        stack.push(p);
      } else if (ent.isFile() && /\.(tif|tiff)$/i.test(ent.name)) {
        out.push(p);
      }
    }
  }
  out.sort();
  return out;
}

function normInspect(r: JuliaInspectResult): InspectResult {
  return {
    ...r,
    format: r.format === 'nc' ? 'nc' : 'tif',
    start: r.start ?? undefined,
    end: r.end ?? undefined,
    times: r.times ?? undefined,
    band: r.band ?? undefined,
    bands: r.bands ?? undefined,
    crs: r.crs ?? undefined,
  };
}

/** Julia 探测单文件元数据 */
export async function inspectLocal(
  filePath: string,
  opts: { format?: LocalFormat; band?: string } = {},
): Promise<InspectResult> {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`路径不存在: ${abs}`);

  const format = opts.format ?? guessFormat(abs);
  const worker = getJuliaWorker();
  const r = await worker.inspect({ path: abs, format, band: opts.band });
  return normInspect(r);
}

/**
 * 注册数据集并写入 catalog。
 * - 文件 .tif / .nc
 * - 目录：扫描其中全部 tif（日期取自文件名 YYYY-MM-DD，否则须 --start/--end）
 */
export async function registerLocal(opts: RegisterLocalOptions): Promise<LocalDataset> {
  const id = opts.id.trim();
  if (!id) throw new Error('id 为空');
  const abs = path.resolve(opts.path);
  if (!fs.existsSync(abs)) throw new Error(`路径不存在: ${abs}`);

  const catalogPath = opts.catalog ?? defaultCatalogPath();
  const format = opts.format ?? guessFormat(abs);
  const stat = fs.statSync(abs);

  let ds: LocalDataset;

  if (format === 'nc') {
    if (!stat.isFile()) throw new Error('nc 注册须为文件');
    const info = await inspectLocal(abs, { format: 'nc', band: opts.band });
    const start = opts.start ?? info.start;
    const end = opts.end ?? info.end;
    if (!start || !end) throw new Error('nc 缺少时间维，请显式 --start/--end');
    ds = {
      id,
      format: 'nc',
      path: abs,
      band: opts.band ?? info.band ?? undefined,
      bounds: opts.bounds ?? info.bounds,
      start: toDay(start),
      end: toDay(end),
      times: info.times ?? undefined,
      ndims: 3,
      collection: opts.collection,
      crs: opts.crs ?? info.crs ?? undefined,
      scale: opts.scale,
      registeredAt: new Date().toISOString(),
    };
  } else if (stat.isDirectory()) {
    const tifs = listTifFiles(abs);
    if (tifs.length === 0) throw new Error(`目录无 tif: ${abs}`);
    const files: NonNullable<LocalDataset['files']> = [];
    let bounds = opts.bounds;
    for (const f of tifs) {
      const side = sidecarDates(f);
      const day = side?.start ?? dayFromName(f) ?? opts.start;
      if (!day) {
        throw new Error(`tif 无日期（sidecar/文件名/--start）: ${path.basename(f)}`);
      }
      const end = side?.end ?? dayFromName(f) ?? opts.end ?? day;
      if (!bounds) {
        if (side?.bounds) bounds = side.bounds;
        else {
          const info = await inspectLocal(f, { format: 'tif' });
          bounds = info.bounds;
        }
      }
      files.push({
        path: f,
        start: toDay(day),
        end: toDay(end),
        id: path.basename(f, path.extname(f)),
      });
    }
    files.sort((a, b) => a.start.localeCompare(b.start));
    if (!bounds) throw new Error('无法确定 bounds');
    ds = {
      id,
      format: 'tif',
      path: abs,
      band: opts.band,
      bounds: opts.bounds ?? bounds,
      start: files[0]!.start,
      end: files[files.length - 1]!.end,
      times: files.map((f) => f.start),
      ndims: 2,
      files,
      collection: opts.collection,
      crs: opts.crs,
      scale: opts.scale,
      registeredAt: new Date().toISOString(),
    };
  } else {
    // 单 tif
    const info = await inspectLocal(abs, { format: 'tif', band: opts.band });
    const day = opts.start ?? dayFromName(abs) ?? info.start;
    if (!day) throw new Error('单 tif 须 --start 或文件名含 YYYY-MM-DD');
    const end = opts.end ?? day;
    ds = {
      id,
      format: 'tif',
      path: abs,
      band: opts.band ?? info.band ?? undefined,
      bounds: opts.bounds ?? info.bounds,
      start: toDay(day),
      end: toDay(end),
      ndims: (info.ndims === 3 ? 3 : 2),
      times: info.times ?? undefined,
      collection: opts.collection,
      crs: opts.crs ?? info.crs ?? undefined,
      scale: opts.scale,
      registeredAt: new Date().toISOString(),
    };
  }

  upsertDataset(catalogPath, ds);
  return ds;
}

export function unregisterLocal(id: string, catalog?: string): boolean {
  return removeDataset(catalog ?? defaultCatalogPath(), id);
}

export function listDatasets(catalog?: string): LocalDataset[] {
  return loadCatalog(catalog ?? defaultCatalogPath()).datasets;
}

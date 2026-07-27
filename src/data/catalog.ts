/**
 * 本地数据目录：
 * 1) catalog.json 注册表（tif / nc）
 * 2) exportBatches sidecar *.json（兼容）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { CacheBounds } from '../export/bounds';
import type {
  LocalCatalogFile, LocalDataset, LocalFormat, LocalFrame,
} from './types';
import { toDay } from './query';

const DEFAULT_CATALOG = 'catalog/local.json';

export function defaultCatalogPath(cwd = process.cwd()): string {
  return process.env.GEE_LOCAL_CATALOG
    ? path.resolve(process.env.GEE_LOCAL_CATALOG)
    : path.resolve(cwd, DEFAULT_CATALOG);
}

function isBounds(b: unknown): b is CacheBounds {
  if (!b || typeof b !== 'object') return false;
  const o = b as Record<string, unknown>;
  return [o.west, o.south, o.east, o.north].every((v) => typeof v === 'number' && Number.isFinite(v));
}

export function loadCatalog(catalogPath: string): LocalCatalogFile {
  const p = path.resolve(catalogPath);
  if (!fs.existsSync(p)) return { version: 1, datasets: [] };
  const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as LocalCatalogFile;
  if (!raw || raw.version !== 1 || !Array.isArray(raw.datasets)) {
    throw new Error(`非法 catalog: ${p}`);
  }
  return raw;
}

export function saveCatalog(catalogPath: string, cat: LocalCatalogFile): void {
  const p = path.resolve(catalogPath);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const next: LocalCatalogFile = { version: 1, datasets: cat.datasets };
  fs.writeFileSync(p, `${JSON.stringify(next, null, 2)}\n`);
}

export function upsertDataset(catalogPath: string, ds: LocalDataset): LocalCatalogFile {
  const cat = loadCatalog(catalogPath);
  const i = cat.datasets.findIndex((d) => d.id === ds.id);
  if (i >= 0) cat.datasets[i] = ds;
  else cat.datasets.push(ds);
  cat.datasets.sort((a, b) => a.id.localeCompare(b.id));
  saveCatalog(catalogPath, cat);
  return cat;
}

export function removeDataset(catalogPath: string, id: string): boolean {
  const cat = loadCatalog(catalogPath);
  const n = cat.datasets.length;
  cat.datasets = cat.datasets.filter((d) => d.id !== id);
  if (cat.datasets.length === n) return false;
  saveCatalog(catalogPath, cat);
  return true;
}

/** 数据集 → 可筛选 LocalFrame 列表 */
export function datasetToFrames(ds: LocalDataset): LocalFrame[] {
  if (ds.format === 'nc' || (ds.ndims === 3 && !ds.files?.length)) {
    return [{
      id: ds.id,
      path: ds.path,
      format: ds.format,
      start: toDay(ds.start),
      end: toDay(ds.end),
      bounds: ds.bounds,
      band: ds.band,
      collection: ds.collection,
      scale: ds.scale,
      crs: ds.crs,
      datasetId: ds.id,
      times: ds.times,
      ndims: ds.ndims,
    }];
  }

  if (ds.files?.length) {
    return ds.files.map((f, i) => ({
      id: f.id ?? `${ds.id}:${path.basename(f.path, path.extname(f.path))}`,
      path: f.path,
      format: 'tif' as const,
      start: toDay(f.start),
      end: toDay(f.end),
      bounds: ds.bounds,
      band: ds.band,
      collection: ds.collection,
      scale: ds.scale,
      crs: ds.crs,
      datasetId: ds.id,
      ndims: 2 as const,
      times: undefined,
    }));
  }

  // 单 tif
  return [{
    id: ds.id,
    path: ds.path,
    format: 'tif',
    start: toDay(ds.start),
    end: toDay(ds.end),
    bounds: ds.bounds,
    band: ds.band,
    collection: ds.collection,
    scale: ds.scale,
    crs: ds.crs,
    datasetId: ds.id,
    ndims: 2,
  }];
}

// ── sidecar（exportBatches 兼容）────────────────────────────────

interface Sidecar {
  cacheId?: string;
  file?: string;
  bucketStart?: string;
  bucketEnd?: string;
  start?: string;
  end?: string;
  bounds?: CacheBounds;
  band?: string;
  collection?: string;
  scale?: number;
  crs?: string;
  path?: string;
}

function frameFromSidecar(dir: string, jsonPath: string, raw: Sidecar): LocalFrame | null {
  const start = raw.bucketStart ?? raw.start;
  const end = raw.bucketEnd ?? raw.end;
  if (!start || !end || !isBounds(raw.bounds)) return null;

  const tifName = raw.file
    ?? (raw.cacheId ? `${raw.cacheId}.tif` : path.basename(jsonPath, '.json') + '.tif');
  const tifPath = raw.path
    ? path.resolve(dir, raw.path)
    : path.resolve(dir, tifName);
  if (!fs.existsSync(tifPath)) return null;

  const id = raw.cacheId ?? path.basename(tifPath, path.extname(tifPath));
  return {
    id,
    path: tifPath,
    format: 'tif',
    start: toDay(start),
    end: toDay(end),
    bounds: raw.bounds,
    band: raw.band,
    collection: raw.collection,
    scale: raw.scale,
    crs: raw.crs,
    ndims: 2,
  };
}

/** 递归扫描 root 下 exportBatches sidecar */
export function scanSidecarDir(root: string): LocalFrame[] {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) return [];

  const out: LocalFrame[] = [];
  const stack = [abs];
  while (stack.length) {
    const dir = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') continue;
        stack.push(p);
        continue;
      }
      if (!ent.isFile() || !ent.name.endsWith('.json')) continue;
      // 跳过注册表本身
      if (ent.name === 'local.json' || ent.name === 'catalog.json') continue;
      let raw: Sidecar;
      try {
        raw = JSON.parse(fs.readFileSync(p, 'utf8')) as Sidecar;
      } catch {
        continue;
      }
      const frame = frameFromSidecar(dir, p, raw);
      if (frame) out.push(frame);
    }
  }
  return out;
}

/** @deprecated 用 scanLocalSources */
export function scanLocalCatalog(root: string): LocalFrame[] {
  return scanSidecarDir(root);
}

export function guessFormat(filePath: string): LocalFormat {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.nc' || ext === '.nc4') return 'nc';
  if (ext === '.tif' || ext === '.tiff') return 'tif';
  // 目录默认 tif 序列
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) return 'tif';
  throw new Error(`无法判定格式（支持 .tif/.tiff/.nc）: ${filePath}`);
}

/** 合并 catalog 注册表 + 可选 sidecar 目录 */
export function scanLocalSources(opts: {
  catalog?: string;
  root?: string;
  datasetId?: string;
}): LocalFrame[] {
  const out: LocalFrame[] = [];

  if (opts.catalog) {
    const cat = loadCatalog(opts.catalog);
    for (const ds of cat.datasets) {
      if (opts.datasetId && ds.id !== opts.datasetId) continue;
      out.push(...datasetToFrames(ds));
    }
  }

  if (opts.root) {
    out.push(...scanSidecarDir(opts.root));
  }

  // 无任何源时：若 catalog 默认路径存在则读
  if (!opts.catalog && !opts.root) {
    const def = defaultCatalogPath();
    if (fs.existsSync(def)) {
      for (const ds of loadCatalog(def).datasets) {
        if (opts.datasetId && ds.id !== opts.datasetId) continue;
        out.push(...datasetToFrames(ds));
      }
    }
  }

  out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
  return out;
}

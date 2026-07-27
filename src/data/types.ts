import type { CacheBounds } from '../export/bounds';

/** 本地栅格格式 */
export type LocalFormat = 'tif' | 'nc';

/** 本地一景 / 一个立方体切片的查询单元 */
export interface LocalFrame {
  id: string;
  path: string;
  format: LocalFormat;
  start: string;
  end: string;
  bounds: CacheBounds;
  band?: string;
  collection?: string;
  scale?: number;
  crs?: string;
  /** 所属注册数据集 id */
  datasetId?: string;
  /** NetCDF 或 stack 的全部时间戳 YYYY-MM-DD */
  times?: string[];
  /** 2=平面；3=时空立方 */
  ndims?: 2 | 3;
}

export interface LocalQuery {
  /** 注册表 catalog.json */
  catalog?: string;
  /** 兼容：exportBatches sidecar 目录 */
  root?: string;
  start?: string;
  end?: string;
  bounds?: CacheBounds;
  collection?: string;
  band?: string;
  /** 只查某数据集 */
  datasetId?: string;
}

/** 注册表中的数据集 */
export interface LocalDataset {
  id: string;
  format: LocalFormat;
  /** 绝对路径：单文件，或 tif 目录 */
  path: string;
  band?: string;
  bounds: CacheBounds;
  start: string;
  end: string;
  times?: string[];
  ndims: 2 | 3;
  collection?: string;
  crs?: string;
  scale?: number;
  /** tif 多文件时每景一条；nc 通常省略 */
  files?: Array<{ path: string; start: string; end: string; id?: string }>;
  registeredAt?: string;
}

export interface LocalCatalogFile {
  version: 1;
  datasets: LocalDataset[];
}

export type LocalOpName = string;

export interface LocalOpContext {
  frames: LocalFrame[];
  bounds?: CacheBounds;
  start?: string;
  end?: string;
  outDir?: string;
  params?: Record<string, unknown>;
}

export type LocalOp = (ctx: LocalOpContext) => Promise<unknown>;

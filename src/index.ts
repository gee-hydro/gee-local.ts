import * as path from 'node:path';

export { path };
export { ee } from './ee';
export type { GeeDailyReduction, GeeTemporal } from './types';

export { validateCacheBounds, type CacheBounds } from './export/bounds';
export {
  export_col,
  export_img,
  export_img_grids,
  listGroups,
} from './export/export-col';
export type {
  Collection,
  DownloadOptions,
  ExportOptions,
  Group,
  GroupOptions,
  TilingOptions,
} from './export/export-col';
export { evaluate, mkpath } from './export/utilize';
export { resample, resampleOptions } from './export/resample';
export * as SurfaceWater_HLS from './dataset/SurfaceWater_HLS';
export type {
  BaseOptions as SurfaceWaterHlsOptions,
  BuildWater as SurfaceWaterBuildWater,
  DownloadOptions as SurfaceWaterHlsDownloadOptions,
  ValidOptions as SurfaceWaterHlsFracValidOptions,
} from './dataset/SurfaceWater_HLS';
import col_frac_valid = require('./export/frac_valid');
export { col_frac_valid };
export { frameCollection } from './export/frame-collection';
export {
  dailyBuckets,
  estimateFrameCount,
  exportBatches,
  makeCacheId,
  nativeBuckets,
  normalizeFrameImage,
  regionGeometry,
  type BatchInfo,
  type Bucket,
  type BuildFrameFn,
  type BuildFrameParams,
  type ExportBatchesOptions,
} from './export/batches';
export {
  cancelTasks,
  getTaskStatuses,
  listJobs,
  listRecentOperations,
  loadJob,
  refreshJob,
  saveJob,
  submitExportTasks,
  type ExportJob,
  type RemoteTaskState,
  type SubmitExportTasksOptions,
  type TaskDestination,
  type TaskRecord,
  type TaskStatusView,
} from './export/tasks';

export {
  configPath,
  getConfigValue,
  loadConfig,
  loadMergedConfig,
  packagesFromConfig,
  projectConfigPath,
  saveConfig,
  userConfigPath,
  type ConfigScope,
  type GdalConfig,
  type GeeHelperConfig,
} from './local/config';
export {
  DEFAULT_PACKAGES_DIR,
  defaultPackagePaths,
  geeIdToRelPath,
  isNodeModuleId,
  mergePackagePaths,
  resolveGeePackage,
  withGeePackageRequire,
} from './local/gee-require';
export {
  addPackage,
  gerritUrl,
  packageDest,
  parseUserPkg,
  primaryPackagesRoot,
  type AddPackageOptions,
  type AddPackageResult,
  type UserPkg,
} from './local/pkg-add';
export {
  runCode,
  runInScriptContext,
  runScript,
  runScripts,
  setupLocalHost,
  type LayerSpec,
  type LocalHost,
  type LocalHostOptions,
  type RunScriptOptions,
  type ScriptContextOptions,
  type TaskSpec,
} from './local/local-host';

export { run as runCli } from './cli';

export {
  applyLocal,
  boundsOverlaps,
  cropLocal,
  dateOverlaps,
  defaultCatalogPath,
  filterFrames,
  getJuliaWorker,
  getLocalOp,
  inspectLocal,
  listDatasets,
  listLocalOps,
  queryLocal,
  registerLocal,
  registerLocalOp,
  runLocalOp,
  scanLocalCatalog,
  scanLocalSources,
  toDay,
  unregisterLocal,
  JuliaWorker,
  type ApplyLocalItem,
  type ApplyLocalOptions,
  type ApplyMode,
  type CropLocalOptions,
  type CropLocalResult,
  type InspectResult,
  type JuliaApplyPayload,
  type JuliaApplyResult,
  type LocalCatalogFile,
  type LocalDataset,
  type LocalFormat,
  type LocalFrame,
  type LocalOp,
  type LocalOpContext,
  type LocalOpName,
  type LocalQuery,
  type RegisterLocalOptions,
} from './data/local';

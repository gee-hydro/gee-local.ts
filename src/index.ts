import * as path from 'node:path';

export { path };
export { ee } from './ee';
export { ensureReady, getInfo } from './auth';
export type { GeeDailyReduction, GeeTemporal } from './types';

export { validateCacheBounds, type CacheBounds } from './export/bounds';
export {
  export_col,
  export_img,
  getDownloadParams,
  listGroups,
} from './export/export.js';
export type {
  Collection,
  DownloadOptions,
  ExportOptions,
  Group,
  GroupOptions,
} from './export/export.js';
export { mkpath } from './export/utilize.js';
export { resample, resampleOptions } from './export/resample.js';
import col_frac_valid = require('./export/frac_valid.js');
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

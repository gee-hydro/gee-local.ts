/**
 * gee-helper 配置：用户级 + 项目级。
 * 路径优先级（高→低）：CLI --package-path > $GEE_JS_PATH > project > user > ./packages
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface GdalConfig {
  /** gdalwarp 可执行文件 */
  command?: string;
  /** PROJ 数据目录；同时设置 PROJ_DATA 与 PROJ_LIB */
  projData?: string;
  /** GeoTIFF SRS 来源，例如 EPSG */
  gtiffSrsSource?: string;
}

export interface GeeHelperConfig {
  /** GEE JS 包根目录（字符串或数组） */
  packages?: string | string[];
  /** 本地 GDAL 配置 */
  gdal?: GdalConfig;
}

export type ConfigScope = 'user' | 'project';

const PROJECT_NAME = '.gee-helper.json';

export function userConfigPath(): string {
  const base = process.env.XDG_CONFIG_HOME
    ?? path.join(os.homedir(), '.config');
  return path.join(base, 'gee-helper', 'config.json');
}

export function projectConfigPath(cwd = process.cwd()): string {
  return path.join(cwd, PROJECT_NAME);
}

export function configPath(scope: ConfigScope, cwd = process.cwd()): string {
  return scope === 'user' ? userConfigPath() : projectConfigPath(cwd);
}

function readJson(file: string): GeeHelperConfig {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf8');
    const o = JSON.parse(raw) as unknown;
    if (o == null || typeof o !== 'object' || Array.isArray(o)) return {};
    return o as GeeHelperConfig;
  } catch {
    return {};
  }
}

export function loadConfig(scope: ConfigScope, cwd = process.cwd()): GeeHelperConfig {
  return readJson(configPath(scope, cwd));
}

/** 合并：project 覆盖 user */
export function loadMergedConfig(cwd = process.cwd()): GeeHelperConfig {
  return { ...loadConfig('user', cwd), ...loadConfig('project', cwd) };
}

export function saveConfig(
  patch: GeeHelperConfig,
  scope: ConfigScope = 'project',
  cwd = process.cwd(),
): string {
  const file = configPath(scope, cwd);
  const next = { ...loadConfig(scope, cwd), ...patch };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return file;
}

export function packagesFromConfig(cfg: GeeHelperConfig, cwd = process.cwd()): string[] {
  const v = cfg.packages;
  if (v == null) return [];
  const list = Array.isArray(v) ? v : [v];
  return list
    .map((s) => String(s).trim())
    .filter(Boolean)
    .map((s) => (path.isAbsolute(s) ? s : path.resolve(cwd, s)));
}

export function getConfigValue(cfg: GeeHelperConfig, key: string): unknown {
  if (key === 'packages') return cfg.packages ?? null;
  return (cfg as Record<string, unknown>)[key] ?? null;
}

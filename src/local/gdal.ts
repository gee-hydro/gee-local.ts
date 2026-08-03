import { execFileSync } from 'node:child_process';
import { loadMergedConfig } from './config';

/** 使用 gee-helper 配置执行 gdalwarp。 */
export function gdalWarp(args: readonly string[], cwd = process.cwd()): void {
  const config = loadMergedConfig(cwd).gdal ?? {};
  const env = { ...process.env };

  if (config.projData) {
    env.PROJ_DATA = config.projData;
    env.PROJ_LIB = config.projData;
  }
  if (config.gtiffSrsSource) {
    env.GTIFF_SRS_SOURCE = config.gtiffSrsSource;
  }

  execFileSync(config.command ?? 'gdalwarp', [...args], {
    cwd,
    env,
    stdio: 'inherit',
  });
}

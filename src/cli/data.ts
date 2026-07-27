/**
 * CLI：本地数据 register / ls / query / crop / apply / ops（不拉 EE）
 */
import type { Cli } from './args';
import {
  applyLocal,
  cropLocal,
  defaultCatalogPath,
  listDatasets,
  listLocalOps,
  queryLocal,
  registerLocal,
  scanLocalSources,
  unregisterLocal,
  type ApplyMode,
  type LocalFormat,
} from '../data/local';
import type { CacheBounds } from '../export/bounds';

function boundsOf(cli: Cli): CacheBounds | undefined {
  if (!cli.bounds) return undefined;
  const [west, south, east, north] = cli.bounds;
  return { west, south, east, north };
}

function catalogOf(cli: Cli): string {
  return cli.catalog ?? defaultCatalogPath();
}

function printFrames(
  frames: ReturnType<typeof queryLocal>,
): void {
  console.log(`# n=${frames.length}`);
  for (const f of frames) {
    const b = f.bounds;
    console.log(
      `${f.format}  ${f.start}..${f.end}  ${f.id}`
      + `  [${b.west},${b.south},${b.east},${b.north}]`
      + (f.band ? `  ${f.band}` : '')
      + (f.ndims ? `  ndims=${f.ndims}` : '')
      + `  ${f.path}`,
    );
  }
}

function parseParams(raw?: string): Record<string, unknown> | undefined {
  if (raw == null || raw === '') return undefined;
  const v = JSON.parse(raw) as unknown;
  if (!v || typeof v !== 'object' || Array.isArray(v)) {
    throw new Error('--params 须为 JSON 对象');
  }
  return v as Record<string, unknown>;
}

function printApplyResult(r: { frames: { id: string }[]; result: {
  type: string;
  out?: string;
  value?: unknown;
  ndims?: number;
  size?: number[];
} }): void {
  const ids = r.frames.map((f) => f.id).join(',');
  const res = r.result;
  if (res.type === 'raster') {
    console.log(`${ids}  raster ndims=${res.ndims} size=${res.size?.join('x')}  ${res.out}`);
  } else if (res.type === 'scalar') {
    console.log(`${ids}  scalar  ${res.value}`);
  } else if (res.type === 'vector') {
    console.log(`${ids}  vector  ${JSON.stringify(res.value)}`);
  } else {
    console.log(`${ids}  ${res.type}  ${JSON.stringify(res.value)}`);
  }
}

export async function cmdData(cli: Cli): Promise<number> {
  const sub = cli.dataArgs[0] ?? 'ls';

  if (sub === 'ops') {
    const ops = listLocalOps();
    console.log(ops.length ? ops.join('\n') : '# 无注册算子');
    return 0;
  }

  if (sub === 'register') {
    if (!cli.id) throw new Error('data register 须 --id');
    if (!cli.path) throw new Error('data register 须 --path');
    let format: LocalFormat | undefined;
    if (cli.format != null) {
      if (cli.format !== 'tif' && cli.format !== 'nc') {
        throw new Error('--format 须 tif|nc');
      }
      format = cli.format;
    }
    const ds = await registerLocal({
      id: cli.id,
      path: cli.path,
      format,
      band: cli.band,
      catalog: catalogOf(cli),
      start: cli.start,
      end: cli.end,
      bounds: boundsOf(cli),
      collection: cli.collection,
      crs: cli.crs,
      scale: cli.scale,
    });
    console.log(`# registered ${ds.id}  format=${ds.format}  ndims=${ds.ndims}`);
    console.log(`  path   ${ds.path}`);
    console.log(`  time   ${ds.start}..${ds.end}` + (ds.times ? `  (n=${ds.times.length})` : ''));
    console.log(`  bounds [${ds.bounds.west},${ds.bounds.south},${ds.bounds.east},${ds.bounds.north}]`);
    if (ds.band) console.log(`  band   ${ds.band}`);
    console.log(`  catalog ${catalogOf(cli)}`);
    return 0;
  }

  if (sub === 'unregister') {
    if (!cli.id) throw new Error('data unregister 须 --id');
    const ok = unregisterLocal(cli.id, catalogOf(cli));
    console.log(ok ? `# removed ${cli.id}` : `# not found ${cli.id}`);
    return ok ? 0 : 1;
  }

  if (sub === 'ls') {
    // 有 catalog 或默认：列注册表；另可扫 root sidecar
    if (cli.catalog || !cli.root) {
      const dss = listDatasets(catalogOf(cli));
      console.log(`# datasets n=${dss.length}  catalog=${catalogOf(cli)}`);
      for (const d of dss) {
        console.log(
          `${d.format}  ${d.id}  ${d.start}..${d.end}  ndims=${d.ndims}`
          + (d.band ? `  ${d.band}` : '')
          + (d.files ? `  files=${d.files.length}` : '')
          + `  ${d.path}`,
        );
      }
    }
    if (cli.root) {
      printFrames(scanLocalSources({ root: cli.root }));
    }
    if (!cli.catalog && !cli.root) {
      // 已用默认 catalog 列数据集；若空再提示
      if (listDatasets(catalogOf(cli)).length === 0) {
        console.log('# 空注册表。ee data register --id ... --path ...');
      }
    }
    return 0;
  }

  if (sub === 'query') {
    printFrames(queryLocal({
      catalog: cli.catalog ?? (cli.root ? undefined : defaultCatalogPath()),
      root: cli.root,
      start: cli.start,
      end: cli.end,
      bounds: boundsOf(cli),
      collection: cli.collection,
      band: cli.band,
      datasetId: cli.id,
    }));
    return 0;
  }

  if (sub === 'crop') {
    const bounds = boundsOf(cli);
    if (!bounds) throw new Error('data crop 须 --bounds');
    if (!cli.outdir) throw new Error('data crop 须 --outdir');
    const results = await cropLocal({
      catalog: cli.catalog ?? (cli.root ? undefined : defaultCatalogPath()),
      root: cli.root,
      start: cli.start,
      end: cli.end,
      bounds,
      outDir: cli.outdir,
      collection: cli.collection,
      band: cli.band,
      datasetId: cli.id,
    });
    console.log(`# crop n=${results.length} → ${cli.outdir}`);
    for (const r of results) {
      const b = r.bbox;
      console.log(
        `${r.frame.id}  [${b.west},${b.south},${b.east},${b.north}]  ${r.out}`,
      );
    }
    return 0;
  }

  if (sub === 'apply') {
    if (!cli.fn) throw new Error('data apply 须 --fn <file.jl>');
    const modeRaw = cli.mode ?? 'stack';
    if (modeRaw !== 'stack' && modeRaw !== 'each') {
      throw new Error('--mode 须 stack|each');
    }
    const items = await applyLocal({
      catalog: cli.catalog ?? (cli.root ? undefined : defaultCatalogPath()),
      root: cli.root,
      start: cli.start,
      end: cli.end,
      bounds: boundsOf(cli),
      collection: cli.collection,
      band: cli.band,
      datasetId: cli.id,
      fn: cli.fn,
      fnName: cli.fnName,
      params: parseParams(cli.paramsJson),
      mode: modeRaw as ApplyMode,
      outDir: cli.outdir,
    });
    console.log(`# apply n=${items.length} mode=${modeRaw} fn=${cli.fn}`);
    for (const it of items) printApplyResult(it);
    return 0;
  }

  throw new Error(`data 子命令须 register|unregister|ls|query|crop|apply|ops，收到: ${sub}`);
}

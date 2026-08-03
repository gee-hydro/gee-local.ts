/**
 * GEE Code Editor 风格 JS 在本地 Node.js 运行的宿主垫片。
 */
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { ensureReady, getInfo } from '../auth';
import { ee } from '../ee';
import { getDownloadUrl } from './download';
import { gdalWarp } from './gdal';
import { mergePackagePaths, withGeePackageRequire } from './gee-require';

const ORIG_MAP_CTOR: MapConstructor | undefined = globalThis.Map;

export interface LayerSpec {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  image: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vis: any;
  name: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TaskSpec = Record<string, any> & { type: string };

export interface LocalHost {
  print: string[];
  layers: LayerSpec[];
  tasks: TaskSpec[];
  charts: TaskSpec[];
  pendingPrints: Promise<void>[];
  getDownloadUrl: typeof getDownloadUrl;
  gdalWarp: (args: readonly string[]) => void;
}

export interface LocalHostOptions {
  echo?: boolean;
}

function safeStringify(v: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seen = new WeakSet<any>();
  return JSON.stringify(v, (_k, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    if (value && typeof value === 'object' && (value as { constructor?: { name?: string } }).constructor?.name === 'ComputedObject') {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return `[ee.${(value as any).name?.() ?? 'ComputedObject'}]`;
    }
    return value;
  });
}

function isEvaluatable(v: unknown): boolean {
  return v != null && typeof v === 'object' && typeof (v as { evaluate?: unknown }).evaluate === 'function';
}

const EVAL_TIMEOUT_MS = 30_000;

async function evalToPlain(v: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): Promise<unknown> {
  if (depth > 5) return '[depth>5]';
  if (v == null) return v;
  if (typeof v !== 'object') return v;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const obj = v as any;
  if (seen.has(obj)) return '[Circular]';
  seen.add(obj);

  if (typeof obj.evaluate === 'function') {
    let resolved: unknown;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      resolved = await Promise.race([
        getInfo(obj),
        new Promise<never>((_r, rej) => {
          timer = setTimeout(
            () => rej(new Error(`eval timeout ${EVAL_TIMEOUT_MS}ms`)),
            EVAL_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (e) {
      return `[eval error: ${e instanceof Error ? e.message : String(e)}]`;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return evalToPlain(resolved, depth + 1, seen);
  }

  if (Array.isArray(v)) {
    return Promise.all(v.map((x) => evalToPlain(x, depth + 1, seen)));
  }
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    out[k] = await evalToPlain(val, depth + 1, seen);
  }
  return out;
}

export function setupLocalHost(opts: LocalHostOptions = {}): LocalHost {
  const echo = opts.echo ?? true;
  const host: LocalHost = {
    print: [],
    layers: [],
    tasks: [],
    charts: [],
    pendingPrints: [],
    getDownloadUrl,
    gdalWarp,
  };
  const g = globalThis as Record<string, unknown>;

  g.ee = ee;

  g.print = (...args: unknown[]) => {
    const hasComputed = args.some(isEvaluatable);
    if (!hasComputed) {
      const parts = args.map((a) => {
        if (typeof a === 'string') return a;
        if (a == null) return String(a);
        return safeStringify(a);
      });
      host.print.push(parts.join(' '));
      if (echo) console.log('[print]', ...args);
      return;
    }
    const lineIdx = host.print.length;
    host.print.push('<evaluating...>');
    const p = (async () => {
      const evaluated = await Promise.all(args.map((a) => evalToPlain(a)));
      host.print[lineIdx] = evaluated
        .map((a) => (typeof a === 'string' ? a : safeStringify(a)))
        .join(' ');
      if (echo) console.log('[print]', ...evaluated);
    })();
    host.pendingPrints.push(p);
  };

  const origMapCtor = ORIG_MAP_CTOR;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const MapShim: any = function (this: unknown, ...args: unknown[]) {
    if (!origMapCtor) return {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return new (origMapCtor as any)(...args);
  };
  if (origMapCtor) {
    MapShim.prototype = origMapCtor.prototype;
    Object.setPrototypeOf(MapShim, origMapCtor);
  }
  MapShim.addLayer = (image: unknown, vis: unknown, name: string) => {
    host.layers.push({ image, vis, name });
    if (echo) console.log(`[Map.addLayer] ${name}`);
  };
  MapShim.centerObject = () => {};
  MapShim.setCenter = () => {};
  MapShim.setOptions = () => {};
  g.Map = MapShim;

  const mkExport = (kind: string) => (params: Record<string, unknown>) => {
    const task = { type: kind, ...params };
    host.tasks.push(task);
    if (echo) console.log(`[Export.${kind}] ${String(params.description ?? params.assetId ?? '')}`);
    return task;
  };
  g.Export = {
    image: {
      toDrive: mkExport('image.toDrive'),
      toAsset: mkExport('image.toAsset'),
      toCloudStorage: mkExport('image.toCloudStorage'),
    },
    table: {
      toDrive: mkExport('table.toDrive'),
      toAsset: mkExport('table.toAsset'),
    },
    video: { toDrive: mkExport('video.toDrive') },
    map: { toCloudStorage: mkExport('map.toCloudStorage') },
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chartNs: any = new Proxy({}, {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: (_t, name: string | symbol): any => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return new Proxy({}, {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        get: (_t2, method: string | symbol): any => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return (...args: any[]) => {
            const fullName = `${String(name)}.${String(method)}`;
            host.charts.push({ type: fullName, args });
            if (echo) console.log(`[Chart.${fullName}]`);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const placeholder: any = { __chartType: fullName };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let proxy: any;
            proxy = new Proxy(placeholder, {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              get: (t, p: string | symbol): any => {
                if (p === 'serialize' || p === 'getInfo') return () => ({ chartType: fullName });
                if (p in t) return (t as Record<string | symbol, unknown>)[p];
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                return (..._a: any[]) => proxy;
              },
            });
            return proxy;
          };
        },
      });
    },
  });
  g.Chart = chartNs;
  g.ui = { Chart: chartNs };

  g._host = host;
  return host;
}

type GlobalKey = 'require' | 'module' | 'exports' | '__filename' | '__dirname';

export interface ScriptContextOptions {
  /** GEE JS 包根目录（可多个）；默认 packages + config + $GEE_JS_PATH */
  packagePaths?: string[];
}

/** 注入 Node 脚本全局（require/module/__dirname），执行后还原。 */
export function runInScriptContext(
  code: string,
  filename: string,
  opts: ScriptContextOptions = {},
): void {
  const absPath = path.resolve(filename);
  const packagePaths = mergePackagePaths(opts.packagePaths);
  const g = globalThis as Record<string, unknown>;
  const keys: GlobalKey[] = ['require', 'module', 'exports', '__filename', '__dirname'];
  const prev: Partial<Record<GlobalKey, unknown>> = {};
  for (const k of keys) prev[k] = g[k];

  const mod: { exports: Record<string, unknown> } = { exports: {} };
  g.require = createRequire(absPath);
  g.module = mod;
  g.exports = mod.exports;
  g.__filename = absPath;
  g.__dirname = path.dirname(absPath);

  try {
    withGeePackageRequire(packagePaths, () => {
      vm.runInThisContext(code, { filename: absPath });
    });
    g.exports = mod.exports;
  } finally {
    for (const k of keys) {
      if (prev[k] === undefined) delete g[k];
      else g[k] = prev[k];
    }
  }
}

export interface RunScriptOptions extends LocalHostOptions, ScriptContextOptions {
  /** 跳过 ensureReady（批量跑时外层只鉴权一次） */
  ready?: boolean;
}

async function runScriptBody(absPath: string, code: string, opts: RunScriptOptions): Promise<LocalHost> {
  const host = setupLocalHost(opts);
  if (!opts.ready) await ensureReady();
  runInScriptContext(code, absPath, opts);
  await Promise.all(host.pendingPrints);
  return host;
}

export async function runScript(scriptPath: string, opts: RunScriptOptions = {}): Promise<LocalHost> {
  const absPath = path.resolve(scriptPath);
  return runScriptBody(absPath, fs.readFileSync(absPath, 'utf8'), opts);
}

/** 多脚本顺序执行，ensureReady 仅一次。 */
export async function runScripts(
  scriptPaths: string[],
  opts: RunScriptOptions = {},
): Promise<LocalHost[]> {
  await ensureReady();
  const out: LocalHost[] = [];
  for (const p of scriptPaths) {
    out.push(await runScript(p, { ...opts, ready: true }));
  }
  return out;
}

export async function runCode(code: string, opts: RunScriptOptions = {}): Promise<LocalHost> {
  const host = setupLocalHost(opts);
  if (!opts.ready) await ensureReady();
  runInScriptContext(code, path.join(process.cwd(), '.<gee-inline>.js'), opts);
  await Promise.all(host.pendingPrints);
  return host;
}

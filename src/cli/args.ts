/**
 * CLI 参数解析
 */
import type { Bucket } from '../export/batches';
import type { TaskDestination } from '../export/tasks';
import type { ConfigScope } from '../local/config';
import type { GeeDailyReduction, GeeTemporal } from '../types';

export type CliDestination = 'local' | TaskDestination;
export type Cmd =
  | 'submit' | 'status' | 'list' | 'jobs' | 'cancel'
  | 'run' | 'add' | 'config' | 'data' | 'help';

export interface Cli {
  cmd: Cmd;
  bounds?: [number, number, number, number];
  start?: string;
  end?: string;
  collection?: string;
  band?: string;
  scale?: number;
  crs?: string;
  temporal?: GeeTemporal;
  stepHours?: number;
  reduction?: GeeDailyReduction;
  bucket: 'auto' | Bucket;
  destination: CliDestination;
  folder?: string;
  gcsBucket?: string;
  outdir?: string;
  concurrency: number;
  fileNamePrefix?: string;
  maxPixels?: number;
  jobDir?: string;
  job?: string;
  task?: string;
  limit: number;
  dryRun: boolean;
  userScript?: string;
  scripts: string[];
  repl: boolean;
  packagePaths: string[];
  configArgs: string[];
  configScope: ConfigScope;
  addSpecs: string[];
  /** ee data <sub> ... */
  dataArgs: string[];
  root?: string;
  /** catalog.json 路径 */
  catalog?: string;
  /** 注册数据集 id */
  id?: string;
  /** 注册数据路径 */
  path?: string;
  /** tif | nc */
  format?: string;
  /** Julia 用户函数文件 */
  fn?: string;
  fnName?: string;
  /** stack | each */
  mode?: string;
  /** JSON object string */
  paramsJson?: string;
}

export const HELP = `
用法: ee <command> [options]

命令
  submit              提交导出任务
  status              查询任务状态
  list                列出近期 GEE 操作
  jobs                列出本地 job 记录
  cancel              取消任务
  run                 本地运行 GEE JS
  add                 安装 GEE 脚本包
  config              读写配置
  data                本地数据（筛选 + Julia apply/crop）
  help, -h            显示本帮助

导出  ee submit
  必填  --collection --band --scale --temporal --bounds --start --end
  可选  --destination local|drive|gcs   (默认 drive)
        --bucket auto|day|week|month|range
        --reduction mean|sum   --step-hours <n>
        --crs --prefix --max-pixels --user-script --dry-run
  local --outdir <dir>  --concurrency <1-16>
  drive --folder <name>  --job-dir <dir>
  gcs   --gcs-bucket <name>  --folder <prefix>

查询  ee status|cancel --job <id> | --task id1,id2
      ee list [--limit N]    ee jobs [--job-dir <dir>]

运行  ee <script.js> [more.js ...]
      ee --repl
      ee --package-path <dir> script.js
      ee run ...                 # 与上等价

包管理  ee add <user>/<pkg>
        ee config show|get|set|path
        ee config set packages <dir> [--user|--project]

本地数据  ee data register|unregister|ls|query|crop|apply|ops
  注册  --id <name> --path <file|dir> [--format tif|nc] [--band var]
        [--catalog catalog/local.json] [--start --end --bounds]
        # tif: SpatialRasterLite；nc: 三维时空 (lon,lat,time)
  卸载  --id <name> [--catalog ...]
  查询  --catalog and/or --root（sidecar 目录）
  筛选  --start --end --bounds --collection --band --id
  crop  --outdir --bounds ...
  apply --fn <file.jl> [--fn-name apply] [--mode stack|each]
        [--params '{...}'] [--outdir dir]
        # apply(ra::SpatRaster; params...)；ra.A 为 2D 或 3D

包路径优先级  --package-path > $GEE_JS_PATH > config > ./packages
require 须带 .js 后缀（Code Editor 语法）
`.trimStart();

const CMDS = new Set<string>([
  'submit', 'status', 'list', 'jobs', 'cancel', 'run', 'add', 'config', 'data',
  'help', '-h', '--help',
]);

function num(flag: string, raw: string, opts: { min?: number; max?: number; int?: boolean } = {}): number {
  const v = Number(raw);
  if (!Number.isFinite(v)) throw new Error(`${flag} 非法`);
  if (opts.int && !Number.isInteger(v)) throw new Error(`${flag} 须整数`);
  if (opts.min != null && v < opts.min) throw new Error(`${flag} 过小`);
  if (opts.max != null && v > opts.max) throw new Error(`${flag} 过大`);
  return v;
}

export function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    cmd: 'help', bucket: 'auto', destination: 'drive',
    concurrency: 1, limit: 20, dryRun: false, scripts: [], repl: false,
    packagePaths: [], configArgs: [], configScope: 'project', addSpecs: [],
    dataArgs: [],
  };
  if (argv.length === 0) return cli;

  const head = argv[0]!;
  if (CMDS.has(head)) {
    cli.cmd = head === '-h' || head === '--help' ? 'help' : head as Cmd;
    argv = argv.slice(1);
  } else {
    // ee script.js [more.js ...]  — 无子命令时直接运行
    cli.cmd = 'run';
  }

  if (cli.cmd === 'config') {
    for (const a of argv) {
      if (a === '--user') cli.configScope = 'user';
      else if (a === '--project') cli.configScope = 'project';
      else cli.configArgs.push(a);
    }
    return cli;
  }
  if (cli.cmd === 'add') {
    for (const a of argv) {
      if (a.startsWith('-')) throw new Error(`未知参数: ${a}`);
      cli.addSpecs.push(a);
    }
    return cli;
  }
  if (cli.cmd === 'data') {
    // 子命令 + 与导出共用的筛选旗标
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!;
      const next = (): string => {
        const v = argv[++i];
        if (v == null) throw new Error(`参数 ${a} 缺值`);
        return v;
      };
      if (!a.startsWith('-')) { cli.dataArgs.push(a); continue; }
      switch (a) {
        case '--root': cli.root = next(); break;
        case '--catalog': cli.catalog = next(); break;
        case '--id': cli.id = next(); break;
        case '--path': cli.path = next(); break;
        case '--format': cli.format = next(); break;
        case '--start': cli.start = next(); break;
        case '--end': cli.end = next(); break;
        case '--collection': cli.collection = next(); break;
        case '--band': cli.band = next(); break;
        case '--outdir': case '--cache-dir': cli.outdir = next(); break;
        case '--fn': cli.fn = next(); break;
        case '--fn-name': cli.fnName = next(); break;
        case '--mode': cli.mode = next(); break;
        case '--params': cli.paramsJson = next(); break;
        case '--bounds': {
          const v = next().split(',').map((s) => Number(s.trim()));
          if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) {
            throw new Error('--bounds 须为 west,south,east,north');
          }
          cli.bounds = v as [number, number, number, number];
          break;
        }
        case '-h': case '--help': cli.cmd = 'help'; break;
        default: throw new Error(`未知参数: ${a}`);
      }
    }
    return cli;
  }

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = (): string => {
      const v = argv[++i];
      if (v == null) throw new Error(`参数 ${a} 缺值`);
      return v;
    };

    switch (a) {
      case '-h': case '--help': cli.cmd = 'help'; break;
      case '--bounds': {
        const v = next().split(',').map((s) => Number(s.trim()));
        if (v.length !== 4 || v.some((x) => !Number.isFinite(x))) {
          throw new Error('--bounds 须为 west,south,east,north');
        }
        cli.bounds = v as [number, number, number, number];
        break;
      }
      case '--start': cli.start = next(); break;
      case '--end': cli.end = next(); break;
      case '--collection': cli.collection = next(); break;
      case '--band': cli.band = next(); break;
      case '--scale': cli.scale = num(a, next(), { min: Number.EPSILON }); break;
      case '--crs': cli.crs = next(); break;
      case '--temporal': {
        const v = next();
        if (v !== 'daily_mean' && v !== 'native' && v !== 'forecast') throw new Error('--temporal 非法');
        cli.temporal = v; break;
      }
      case '--step-hours': cli.stepHours = num(a, next(), { min: Number.EPSILON, max: 24 }); break;
      case '--reduction': {
        const v = next();
        if (v !== 'mean' && v !== 'sum') throw new Error('--reduction 须 mean|sum');
        cli.reduction = v; break;
      }
      case '--bucket': {
        const v = next();
        if (!['auto', 'day', 'week', 'month', 'range'].includes(v)) throw new Error('--bucket 非法');
        cli.bucket = v as Cli['bucket']; break;
      }
      case '--destination': {
        const v = next();
        if (v !== 'drive' && v !== 'gcs' && v !== 'local') throw new Error('--destination 须 drive|local|gcs');
        cli.destination = v; break;
      }
      case '--folder': cli.folder = next(); break;
      case '--gcs-bucket': cli.gcsBucket = next(); break;
      case '--outdir': case '--cache-dir': cli.outdir = next(); break;
      case '--concurrency': cli.concurrency = num(a, next(), { int: true, min: 1, max: 16 }); break;
      case '--user-script': cli.userScript = next(); break;
      case '--prefix': cli.fileNamePrefix = next(); break;
      case '--max-pixels': cli.maxPixels = num(a, next(), { min: Number.EPSILON }); break;
      case '--job-dir': cli.jobDir = next(); break;
      case '--job': cli.job = next(); break;
      case '--task': cli.task = next(); break;
      case '--limit': cli.limit = num(a, next(), { int: true, min: 1 }); break;
      case '--dry-run': cli.dryRun = true; break;
      case '--repl': case '-i': cli.repl = true; break;
      case '--package-path': case '--gee-path': cli.packagePaths.push(next()); break;
      default:
        if (cli.cmd === 'run' && !a.startsWith('-')) { cli.scripts.push(a); break; }
        throw new Error(`未知参数: ${a}`);
    }
  }
  return cli;
}

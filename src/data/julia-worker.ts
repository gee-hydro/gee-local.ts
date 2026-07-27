/**
 * SpatialRasterLite JSON-Lines worker（长驻）。
 * 协议：stdin 一行请求，stdout 一行响应；大数组不经 stdout。
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import * as path from 'node:path';
import type { CacheBounds } from '../export/bounds';

export interface JuliaInfoResult {
  bbox: CacheBounds;
  bands: string[] | null;
  nband: number;
  cellsize: [number, number];
}

export interface JuliaCropResult {
  out: string;
  bbox: CacheBounds;
}

/** Julia apply 返回：栅格落盘 / 标量 / 向量 / json */
export type JuliaApplyResult =
  | {
    type: 'raster';
    out: string;
    bbox: CacheBounds;
    ndims: number;
    size: number[];
  }
  | { type: 'scalar'; value: number }
  | { type: 'vector'; value: number[] }
  | { type: 'json'; value: unknown };

export interface JuliaInspectResult {
  format: 'tif' | 'nc' | string;
  path: string;
  bounds: CacheBounds;
  ndims: 2 | 3 | number;
  size?: number[];
  bands?: string[] | null;
  band?: string | null;
  times?: string[] | null;
  start?: string | null;
  end?: string | null;
  cellsize?: number[];
  crs?: string | null;
}

export interface JuliaApplyPayload {
  paths: string[];
  times?: string[];
  bounds?: CacheBounds;
  band?: string;
  /** nc 时间闭区间 */
  start?: string;
  end?: string;
  /** 用户 .jl 文件，须定义 fnName（默认 apply） */
  fnFile?: string;
  /** 内联 Julia 代码 */
  fnCode?: string;
  fnName?: string;
  params?: Record<string, unknown>;
  /** type=raster 时输出路径 */
  out?: string;
}

type Pending = {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
};

const DEFAULT_PROJECT = path.resolve(__dirname, '../../julia');
const DEFAULT_SCRIPT = path.join(DEFAULT_PROJECT, 'gee_local_worker.jl');

export class JuliaWorker {
  private child: ChildProcessWithoutNullStreams | null = null;
  private buf = '';
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private starting: Promise<void> | null = null;

  constructor(
    private readonly opts: {
      juliaBin?: string;
      project?: string;
      script?: string;
      timeoutMs?: number;
    } = {},
  ) {}

  private get juliaBin(): string {
    return this.opts.juliaBin
      ?? process.env.JULIA_BIN
      ?? 'julia';
  }

  private get project(): string {
    return this.opts.project
      ?? process.env.GEE_JULIA_PROJECT
      ?? DEFAULT_PROJECT;
  }

  private get script(): string {
    return this.opts.script ?? DEFAULT_SCRIPT;
  }

  private get timeoutMs(): number {
    return this.opts.timeoutMs ?? 120_000;
  }

  async ensureStarted(): Promise<void> {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.spawn().finally(() => { this.starting = null; });
    return this.starting;
  }

  private spawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        this.juliaBin,
        [`--project=${this.project}`, this.script],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      this.child = child;
      this.buf = '';

      const onFail = (err: Error) => {
        this.failAll(err);
        reject(err);
      };

      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => this.onData(chunk));
      child.stderr.setEncoding('utf8');
      child.stderr.on('data', (chunk: string) => {
        if (process.env.GEE_JULIA_DEBUG === '1') process.stderr.write(chunk);
      });
      child.on('error', (e) => onFail(e));
      child.on('exit', (code, signal) => {
        this.child = null;
        this.failAll(new Error(`julia worker 退出 code=${code} signal=${signal}`));
      });

      // 就绪：ping
      void this.rawCall('ping', {})
        .then(() => resolve())
        .catch((e) => onFail(e instanceof Error ? e : new Error(String(e))));
    });
  }

  private onData(chunk: string): void {
    this.buf += chunk;
    let i: number;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: { id?: number; ok?: boolean; result?: unknown; error?: string };
      try {
        msg = JSON.parse(line) as typeof msg;
      } catch {
        continue;
      }
      if (msg.id == null) continue;
      const p = this.pending.get(msg.id);
      if (!p) continue;
      this.pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? 'julia error'));
    }
  }

  private failAll(err: Error): void {
    for (const [, p] of this.pending) p.reject(err);
    this.pending.clear();
  }

  private rawCall(op: string, payload: Record<string, unknown>): Promise<unknown> {
    const child = this.child;
    if (!child?.stdin.writable) {
      return Promise.reject(new Error('julia worker 未启动'));
    }
    const id = this.nextId++;
    const line = JSON.stringify({ id, op, ...payload }) + '\n';
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`julia ${op} 超时 ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); resolve(v); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
      child.stdin.write(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  async call<T>(op: string, payload: Record<string, unknown> = {}): Promise<T> {
    await this.ensureStarted();
    try {
      return await this.rawCall(op, payload) as T;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 仅进程挂了才重启；业务错误直接抛
      const dead = !this.child || /julia worker 退出|julia worker 未启动/.test(msg);
      if (!dead) throw e;
      if (this.child) {
        try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
        this.child = null;
      }
      await this.ensureStarted();
      return await this.rawCall(op, payload) as T;
    }
  }

  info(tifPath: string): Promise<JuliaInfoResult> {
    return this.call('info', { path: tifPath });
  }

  crop(tifPath: string, bounds: CacheBounds, out: string, band?: string): Promise<JuliaCropResult> {
    return this.call('crop', { path: tifPath, bounds, out, band });
  }

  inspect(opts: {
    path: string;
    format?: string;
    band?: string;
  }): Promise<JuliaInspectResult> {
    return this.call('inspect', {
      path: opts.path,
      format: opts.format,
      band: opts.band,
    });
  }

  /**
   * 调用用户 Julia 函数。统一签名：apply(ra::SpatRaster; params...)
   * paths 长度 1 → 2D/原维/nc立方；>1 tif → stack (nx,ny,nt)
   */
  apply(payload: JuliaApplyPayload): Promise<JuliaApplyResult> {
    if (!payload.fnFile && !payload.fnCode) {
      return Promise.reject(new Error('apply 需要 fnFile 或 fnCode'));
    }
    if (!payload.paths?.length) {
      return Promise.reject(new Error('apply 需要 paths'));
    }
    return this.call('apply', {
      paths: payload.paths,
      times: payload.times,
      bounds: payload.bounds,
      band: payload.band,
      start: payload.start,
      end: payload.end,
      fn_file: payload.fnFile,
      fn_code: payload.fnCode,
      fn_name: payload.fnName ?? 'apply',
      params: payload.params ?? {},
      out: payload.out,
    });
  }

  async stop(): Promise<void> {
    if (!this.child) return;
    try {
      await this.rawCall('shutdown', {});
    } catch { /* ignore */ }
    try { this.child.kill('SIGTERM'); } catch { /* ignore */ }
    this.child = null;
    this.failAll(new Error('julia worker stopped'));
  }
}

let shared: JuliaWorker | null = null;

export function getJuliaWorker(): JuliaWorker {
  if (!shared) shared = new JuliaWorker();
  return shared;
}

/**
 * CLI：run / repl（加载 local-host + earthengine）
 */
import * as path from 'node:path';
import * as readline from 'node:readline';
import { ee } from '../ee';
import {
  closeMapServer,
  openBrowser,
  startMapServer,
  type MapServer,
} from '../local/map-server';
import { runScript, type LocalHost } from '../local/local-host';
import type { Cli } from './args';

function report(host: LocalHost): void {
  console.log('\n# 捕获结果');
  console.log(`  print  : ${host.print.length} 条`);
  console.log(`  layers : ${host.layers.length} 个`);
  console.log(`  tasks  : ${host.tasks.length} 个 (${host.tasks.map((t) => t.type).join(', ') || '-'})`);
  console.log(`  charts : ${host.charts.length} 个`);
  if (host.mapOutput) console.log(`  map    : ${host.mapOutput}`);
  if (host.tasks.length) {
    console.log('\n# 任务详情');
    for (const t of host.tasks) {
      console.log(`  - ${t.type}  ${t.description ?? t.assetId ?? ''}`);
    }
  }
}

async function exposeMaps(files: string[]): Promise<MapServer | undefined> {
  if (!files.length || !process.stdout.isTTY || process.env.GEE_MAP_SERVER === '0') {
    return undefined;
  }
  const map = await startMapServer(files);
  console.log(`[Map] ${map.url}`);
  if (process.env.GEE_MAP_OPEN !== '0') openBrowser(map.url);
  return map;
}

async function waitForInterrupt(map: MapServer): Promise<void> {
  console.log('[Map] 服务运行中；按 Ctrl+C 关闭。');
  await new Promise<void>((resolve) => {
    let closing = false;
    const stop = () => {
      if (closing) return;
      closing = true;
      void closeMapServer(map).then(resolve);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export async function cmdRun(cli: Cli): Promise<number> {
  if (!cli.scripts.length && !cli.repl) {
    console.error('用法: ee <script.js> [more.js ...]\n      ee --repl');
    return 2;
  }
  const t0 = Date.now();
  await ee.Initialize();
  console.log(`[gee] auth ready in ${Date.now() - t0}ms`);

  const opts = { ready: true as const, packagePaths: cli.packagePaths };
  if (cli.packagePaths.length) {
    console.log(`[gee] package-path: ${cli.packagePaths.join(path.delimiter)}`);
  }

  let code = 0;
  const mapFiles: string[] = [];
  for (const s of cli.scripts) {
    try {
      console.log(`\n========== ${s} ==========`);
      const host = await runScript(s, opts);
      report(host);
      if (host.mapOutput) mapFiles.push(host.mapOutput);
    } catch (e) {
      console.error(`脚本失败 (${s}):`, e instanceof Error ? e.message : String(e));
      code = 1;
    }
  }
  if (!cli.repl) {
    const map = await exposeMaps(mapFiles);
    if (map) await waitForInterrupt(map);
    return code;
  }

  const mapServers: MapServer[] = [];
  const initialMap = await exposeMaps(mapFiles);
  if (initialMap) mapServers.push(initialMap);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((r) => rl.question(q, r));
  console.log('\n# REPL（鉴权已就绪）。路径回车运行，quit 退出。');
  for (;;) {
    const line = (await ask('gee> ')).trim();
    if (!line || line === 'quit' || line === 'exit') break;
    try {
      console.log(`\n========== ${line} ==========`);
      const host = await runScript(line, opts);
      report(host);
      const map = await exposeMaps(host.mapOutput ? [host.mapOutput] : []);
      if (map) mapServers.push(map);
    } catch (e) {
      console.error('脚本失败:', e instanceof Error ? e.message : String(e));
      code = 1;
    }
  }
  rl.close();
  await Promise.all(mapServers.map(closeMapServer));
  return code;
}

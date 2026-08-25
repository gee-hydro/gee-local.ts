/**
 * 对比有/无磁盘缓存时 ee.Initialize 的耗时。
 * 必须另起进程：同进程里 readyPromise 只会初始化一次。
 * 仅 EE_BENCHMARK=1 时运行，避免网络波动影响单测。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const CACHE_DIR = join(homedir(), '.cache/gee-helper');
const CACHE_FILES = ['access-token.json', 'algorithms.json'];
const EE_DIR = join(homedir(), '.config/earthengine');
const runBenchmark = process.env.EE_BENCHMARK === '1' && existsSync(join(EE_DIR, 'credentials'));

const CHILD = `
const ee = require('ee-auth');
const t = Date.now();
ee.Initialize()
  .then(() => console.log('READY_MS=' + (Date.now() - t)))
  .catch((err) => { console.error(err); process.exit(1); });
`;

function measureReadyMs(): number {
  const child = spawnSync(process.execPath, ['-e', CHILD], {
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (child.status !== 0) {
    throw new Error(child.stderr || 'ee.Initialize failed');
  }
  const line = child.stdout.split('\n').find((s) => s.startsWith('READY_MS='));
  if (!line) throw new Error(`missing READY_MS:\n${child.stdout}`);
  return Number(line.slice('READY_MS='.length));
}

function backupCache(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ee-auth-cache-'));
  for (const name of CACHE_FILES) {
    const src = join(CACHE_DIR, name);
    if (existsSync(src)) copyFileSync(src, join(dir, name));
  }
  return dir;
}

function restoreCache(backupDir: string): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  for (const name of CACHE_FILES) {
    const src = join(backupDir, name);
    if (existsSync(src)) copyFileSync(src, join(CACHE_DIR, name));
  }
  rmSync(backupDir, { recursive: true, force: true });
}

function removeCache(): void {
  for (const name of CACHE_FILES) {
    rmSync(join(CACHE_DIR, name), { force: true });
  }
}

test('有缓存时 ee.Initialize 明显更快', { skip: !runBenchmark }, () => {
  measureReadyMs(); // 预热：写出 token / 算法表
  const cachedMs = measureReadyMs();

  const backupDir = backupCache();
  removeCache();
  let coldMs = 0;
  try {
    coldMs = measureReadyMs();
  } finally {
    restoreCache(backupDir);
  }

  assert.ok(cachedMs < 200, `有缓存应 < 200ms，实际 ${cachedMs}ms`);
  assert.ok(
    coldMs > cachedMs * 5,
    `无缓存应比有缓存慢 5 倍以上：${coldMs}ms vs ${cachedMs}ms`,
  );
});

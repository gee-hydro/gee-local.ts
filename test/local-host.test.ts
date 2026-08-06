/**
 * local-host 单元测试：不连 GEE 网络，验证 polyfill 注入与捕获
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as vm from 'node:vm';
import { runCode, runInScriptContext, setupLocalHost } from '../src/local/local-host';

beforeEach(() => {
  // 清除宿主全局，避免上一次测试污染
  for (const k of ['print', 'Map', 'Export', 'Chart', 'ui', '_host']) {
    delete (globalThis as Record<string, unknown>)[k];
  }
});

test('setupLocalHost 安装宿主全局 + _host', () => {
  const host = setupLocalHost({ echo: false });
  assert.equal(typeof globalThis.print, 'function');
  // Map 是函数（构造器）—— 兼作 JS 内置 Map 子类 + GEE widget
  assert.equal(typeof globalThis.Map, 'function');
  assert.equal(typeof globalThis.Export, 'object');
  assert.equal(typeof globalThis.Chart, 'object');
  assert.equal(typeof (globalThis as Record<string, unknown>).ui, 'object');
  assert.equal(typeof host.getDownloadUrl, 'function');
  assert.equal(typeof host.gdalWarp, 'function');
  assert.equal((globalThis as Record<string, unknown>)._host, host);
  assert.equal(host.print.length, 0);
  assert.equal(host.layers.length, 0);
  assert.equal(host.tasks.length, 0);
  assert.equal(host.charts.length, 0);
});

test('Map shim 同时充当 JS 内置 Map（new Map() / .set() / .get()）', () => {
  setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Map: any = (globalThis as any).Map;
  const m = new Map();
  assert.equal(m instanceof Map, true);
  assert.equal(m.size, 0);
  m.set('k', 1);
  assert.equal(m.get('k'), 1);
  assert.equal(m.size, 1);
  // 静态方法（继承自内置 Map）
  const fromArr = new Map([['a', 1], ['b', 2]]);
  assert.equal(fromArr.size, 2);
  // GEE widget 方法仍在
  Map.addLayer('img', { min: 0 }, 'L');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const host: any = (globalThis as any)._host;
  assert.equal(host.layers.length, 1);
});

test('print 捕获字符串与对象', () => {
  const host = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const print: any = (globalThis as any).print;
  print('hello');
  print('count:', 42);
  print('obj:', { a: 1, b: [2, 3] });
  assert.equal(host.print.length, 3);
  assert.match(host.print[0]!, /^hello$/);
  assert.match(host.print[1]!, /^count: 42$/);
  assert.match(host.print[2]!, /"a":1/);
});

test('print 处理循环引用', () => {
  const host = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const print: any = (globalThis as any).print;
  const a: Record<string, unknown> = { name: 'a' };
  a.self = a;
  print(a);
  assert.match(host.print[0]!, /\[Circular\]/);
});

test('Map.addLayer / centerObject / setCenter 不崩', () => {
  const host = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Map: any = (globalThis as any).Map;
  Map.addLayer('img', { min: 0, max: 100 }, 'layer1');
  Map.centerObject('img');
  Map.setCenter(105, 35, 4);
  Map.setOptions('SATELLITE');
  assert.equal(host.layers.length, 1);
  assert.deepEqual(host.layers[0], { image: 'img', vis: { min: 0, max: 100 }, name: 'layer1' });
});

test('Export.image.toDrive / toAsset / toCloudStorage 全捕获', () => {
  const host = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Export: any = (globalThis as any).Export;
  const task = Export.image.toDrive({ image: 'i', description: 't1', scale: 100 });
  Export.image.toAsset({ image: 'i', assetId: 'users/me/t1' });
  Export.image.toCloudStorage({ image: 'i', bucket: 'b', fileNamePrefix: 'p' });
  Export.table.toDrive({ collection: 'c', description: 't2' });
  assert.equal(task, host.tasks[0]);
  assert.equal(host.tasks.length, 4);
  assert.deepEqual(host.tasks.map((t) => t.type), [
    'image.toDrive', 'image.toAsset', 'image.toCloudStorage', 'table.toDrive',
  ]);
});

test('Chart.* 二级代理 + 链式占位', () => {
  const host = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Chart: any = (globalThis as any).Chart;
  const chart = Chart.image.series({ x: 1 });
  // 链式：任意方法返回自身直到 serialize / getInfo
  chart.setOptions({}).setSeriesNames(['a']);
  assert.equal(host.charts.length, 1);
  assert.equal(host.charts[0]!.type, 'image.series');
  const info = chart.getInfo();
  assert.deepEqual(info, { chartType: 'image.series' });
});

test('Chart / ui.Chart 共享捕获', () => {
  const host = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { Chart, ui }: any = globalThis;
  Chart.image.series({});
  Chart.feature.byFeature({});
  ui.Chart.array.values({});
  assert.deepEqual(host.charts.map((c) => c.type), ['image.series', 'feature.byFeature', 'array.values']);
});

test('vm.runInThisContext 下顶层 var/function 落到 globalThis（Code Editor 行为）', () => {
  setupLocalHost({ echo: false });
  vm.runInThisContext(`
    var myVar = 42;
    function myFn() { return myVar * 2; }
    print('myVar =', myVar, 'myFn() =', myFn());
  `, { filename: '<test>' });
  assert.equal((globalThis as Record<string, unknown>).myVar, 42);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal((globalThis as any).myFn(), 84);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const host: any = (globalThis as any)._host;
  assert.equal(host.print.length, 1);
});

test('runInScriptContext 注入 require/module/__dirname 且执行后还原', () => {
  setupLocalHost({ echo: false });
  const g = globalThis as Record<string, unknown>;
  assert.equal(g.require, undefined);

  runInScriptContext(`
    var path = require('node:path');
    var fs = require('node:fs');
    print('base', path.basename(__filename));
    print('hasRead', typeof fs.readFileSync);
    print('dir', __dirname);
    module.exports = { ok: true };
  `, __filename);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const host: any = (globalThis as any)._host;
  assert.equal(host.print.length, 3);
  assert.match(host.print[0]!, /local-host\.test\.ts/);
  assert.match(host.print[1]!, /hasRead function/);
  assert.match(host.print[2]!, /dir /);
  // 还原，不污染全局
  assert.equal(g.require, undefined);
  assert.equal(g.__filename, undefined);
});

test('runCode 等待脚本返回的异步任务', async () => {
  const host = await runCode(
    `(async function () {
      await new Promise(function (resolve) { setTimeout(resolve, 5); });
      print('done');
    })();`,
    { ready: true, echo: false },
  );
  assert.deepEqual(host.print, ['done']);
});

test('runCode 传播 pendingPrints 异步失败', async () => {
  await assert.rejects(
    runCode(
      `_host.pendingPrints.push(Promise.reject(new Error('async failed')));`,
      { ready: true, echo: false },
    ),
    /async failed/,
  );
});

test('多次调用 setupLocalHost 替换宿主（清空旧 capture）', () => {
  const h1 = setupLocalHost({ echo: false });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).print('a');
  assert.equal(h1.print.length, 1);
  const h2 = setupLocalHost({ echo: false });
  assert.equal(h2.print.length, 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).print('b');
  assert.equal(h2.print.length, 1);
  // h1 不再被全局引用，但仍是孤立对象
  assert.equal(h1.print.length, 1);
});
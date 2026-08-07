import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { closeMapServer, startMapServer } from '../src/local/map-server';

test('内置 Map 服务返回生成的 HTML', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-map-server-'));
  const file = path.join(dir, '测试 map.html');
  fs.writeFileSync(file, '<h1>map</h1>');
  const map = await startMapServer([file]);
  t.after(async () => {
    await closeMapServer(map);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const response = await fetch(map.url);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<h1>map</h1>');
  assert.match(response.headers.get('content-type') || '', /^text\/html/);
});

test('多个地图生成索引页', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-map-server-'));
  const files = ['a.html', 'b.html'].map((name) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, name);
    return file;
  });
  const map = await startMapServer(files);
  t.after(async () => {
    await closeMapServer(map);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const html = await (await fetch(map.url)).text();
  assert.match(html, /a\.html/);
  assert.match(html, /b\.html/);
});

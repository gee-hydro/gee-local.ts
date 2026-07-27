/**
 * 本地数据：日期/范围筛选（离线，不启 Julia）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  boundsOverlaps,
  dateOverlaps,
  filterFrames,
  queryLocal,
  scanLocalCatalog,
  toDay,
  type LocalFrame,
} from '../src/data/local';

const frame = (partial: Partial<LocalFrame> & Pick<LocalFrame, 'id' | 'start' | 'end'>): LocalFrame => ({
  path: `/tmp/${partial.id}.tif`,
  format: 'tif',
  bounds: { west: 100, south: 20, east: 110, north: 30 },
  ...partial,
});

test('toDay: 截 ISO', () => {
  assert.equal(toDay('2024-07-01'), '2024-07-01');
  assert.equal(toDay('2024-07-01T08:00:00Z'), '2024-07-01');
});

test('dateOverlaps: 闭区间', () => {
  assert.equal(dateOverlaps('2024-07-01', '2024-07-10', '2024-07-10', '2024-07-20'), true);
  assert.equal(dateOverlaps('2024-07-01', '2024-07-10', '2024-07-11', '2024-07-20'), false);
  assert.equal(dateOverlaps('2024-07-05', '2024-07-05', '2024-07-01', '2024-07-31'), true);
});

test('boundsOverlaps: 相接算相交', () => {
  const a = { west: 0, south: 0, east: 10, north: 10 };
  assert.equal(boundsOverlaps(a, { west: 10, south: 0, east: 20, north: 10 }), true);
  assert.equal(boundsOverlaps(a, { west: 10.1, south: 0, east: 20, north: 10 }), false);
  assert.equal(boundsOverlaps(a, { west: 2, south: 2, east: 3, north: 3 }), true);
});

test('filterFrames: 日期+范围+band', () => {
  const frames = [
    frame({ id: 'a', start: '2024-07-01', end: '2024-07-01', band: 'sm', bounds: { west: 108, south: 29, east: 116, north: 33 } }),
    frame({ id: 'b', start: '2024-07-15', end: '2024-07-15', band: 'sm', bounds: { west: 108, south: 29, east: 116, north: 33 } }),
    frame({ id: 'c', start: '2024-07-01', end: '2024-07-01', band: 'ndvi', bounds: { west: 120, south: 29, east: 130, north: 33 } }),
  ];
  const hit = filterFrames(frames, {
    start: '2024-07-01',
    end: '2024-07-10',
    bounds: { west: 110, south: 30, east: 111, north: 31 },
    band: 'sm',
  });
  assert.deepEqual(hit.map((f) => f.id), ['a']);
});

test('scanLocalCatalog + queryLocal: 读 sidecar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-local-'));
  try {
    const id = 'demo001';
    const tif = path.join(dir, `${id}.tif`);
    fs.writeFileSync(tif, Buffer.alloc(2048, 1)); // 占位
    fs.writeFileSync(path.join(dir, `${id}.json`), `${JSON.stringify({
      cacheId: id,
      file: `${id}.tif`,
      bucketStart: '2024-07-01',
      bucketEnd: '2024-07-01',
      bounds: { west: 108.5, south: 29, east: 116.2, north: 33.3 },
      band: 'sm_surface',
      collection: 'NASA/SMAP/SPL4SMGP/008',
    }, null, 2)}\n`);

    const all = scanLocalCatalog(dir);
    assert.equal(all.length, 1);
    assert.equal(all[0]!.id, id);

    const q = queryLocal({
      root: dir,
      start: '2024-07-01',
      end: '2024-07-02',
      bounds: { west: 110, south: 30, east: 111, north: 31 },
    });
    assert.equal(q.length, 1);

    const miss = queryLocal({
      root: dir,
      start: '2020-01-01',
      end: '2020-01-02',
    });
    assert.equal(miss.length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

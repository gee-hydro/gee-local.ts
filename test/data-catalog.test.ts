/**
 * 本地 catalog 注册表（离线，不启 Julia）
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  datasetToFrames,
  loadCatalog,
  scanLocalSources,
  upsertDataset,
} from '../src/data/catalog';
import { filterFrames as ff } from '../src/data/query';
import type { LocalDataset } from '../src/data/types';

test('catalog upsert + datasetToFrames nc/tif', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-cat-'));
  const cat = path.join(dir, 'local.json');
  try {
    const nc: LocalDataset = {
      id: 'sm_nc',
      format: 'nc',
      path: '/data/sm.nc',
      band: 'sm',
      bounds: { west: 110, south: 30, east: 113, north: 32 },
      start: '2024-07-01',
      end: '2024-07-02',
      times: ['2024-07-01', '2024-07-02'],
      ndims: 3,
    };
    upsertDataset(cat, nc);
    const tif: LocalDataset = {
      id: 'sm_tif',
      format: 'tif',
      path: '/data/tif',
      bounds: { west: 108, south: 29, east: 116, north: 33 },
      start: '2024-07-01',
      end: '2024-07-02',
      ndims: 2,
      files: [
        { path: '/data/tif/a.tif', start: '2024-07-01', end: '2024-07-01', id: 'a' },
        { path: '/data/tif/b.tif', start: '2024-07-02', end: '2024-07-02', id: 'b' },
      ],
    };
    upsertDataset(cat, tif);

    const loaded = loadCatalog(cat);
    assert.equal(loaded.datasets.length, 2);

    const ncFrames = datasetToFrames(nc);
    assert.equal(ncFrames.length, 1);
    assert.equal(ncFrames[0]!.format, 'nc');
    assert.equal(ncFrames[0]!.ndims, 3);

    const tifFrames = datasetToFrames(tif);
    assert.equal(tifFrames.length, 2);

    const all = scanLocalSources({ catalog: cat });
    assert.equal(all.length, 3);

    const q = ff(all, { start: '2024-07-01', end: '2024-07-01' });
    assert.equal(q.length, 2); // nc cube overlaps + tif a
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

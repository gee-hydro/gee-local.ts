const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const localExport = require('../src/export/export.js');

function mockCollection(indices, timestamps) {
  return {
    size: () => indices.length,
    aggregate_array(property) {
      return {
        evaluate(callback) {
          callback(property === 'system:index' ? indices : timestamps);
        },
      };
    },
  };
}

test('export_img 通过回调注入数据源与影像构建逻辑', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-export-img-'));
  const group = { key: 'g1', name: 'test', indices: ['i1'] };
  const source = {};
  const image = {};
  const previousHost = global._host;
  global._host = {
    getDownloadUrl(received, params) {
      assert.equal(received, image);
      assert.equal(params.name, 'test');
      return Promise.resolve('https://example.test/test.tif');
    },
  };

  try {
    const filename = await localExport.export_img(group, 1, 1, {
      outdir,
      log: false,
      getSource(received) {
        assert.equal(received, group);
        return source;
      },
      buildImage(received) {
        assert.equal(received, source);
        return image;
      },
      fetch: async () => ({
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
      }),
    });

    assert.equal(filename, path.join(outdir, 'test.tif'));
    assert.deepEqual([...fs.readFileSync(filename)], [1, 2, 3]);
  } finally {
    if (previousHost === undefined) delete global._host;
    else global._host = previousHost;
    fs.rmSync(outdir, { recursive: true, force: true });
  }
});

test('export_img 默认按 indexProperty 筛选数据源', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-export-source-'));
  const previousEe = global.ee;
  const previousHost = global._host;
  const source = {};
  const filter = {};
  global.ee = {
    Filter: {
      inList(property, indices) {
        assert.equal(property, 'scene_id');
        assert.deepEqual(indices, ['i1']);
        return filter;
      },
    },
  };
  global._host = {
    getDownloadUrl: () => Promise.resolve('https://example.test/test.tif'),
  };

  try {
    await localExport.export_img(
      { key: 'g1', name: 'test', indices: ['i1'] },
      1,
      1,
      {
        collection: {
          filter(received) {
            assert.equal(received, filter);
            return source;
          },
        },
        indexProperty: 'scene_id',
        outdir,
        log: false,
        buildImage(received) {
          assert.equal(received, source);
          return {};
        },
        fetch: async () => ({
          ok: true,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        }),
      },
    );
  } finally {
    if (previousEe === undefined) delete global.ee;
    else global.ee = previousEe;
    if (previousHost === undefined) delete global._host;
    else global._host = previousHost;
    fs.rmSync(outdir, { recursive: true, force: true });
  }
});

test('export_img 支持切片下载并用 GDAL 合并', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-export-tiles-'));
  const previousEe = global.ee;
  const previousHost = global._host;
  const params = [];
  let warpArgs;
  global.ee = {
    Geometry: {
      Rectangle(bounds, crs, geodesic) {
        return { bounds, crs, geodesic };
      },
    },
  };
  global._host = {
    getDownloadUrl(_image, received) {
      params.push(received);
      return Promise.resolve('https://example.test/tile.tif');
    },
    gdalWarp(args) {
      warpArgs = args;
      fs.writeFileSync(args[args.length - 1], 'merged');
    },
  };

  try {
    const filename = await localExport.export_img(
      { key: '20240101', name: 'water_20240101', indices: ['i1'] },
      1,
      1,
      {
        outdir,
        log: false,
        getSource: () => ({}),
        buildImage: () => ({}),
        fetch: async () => ({
          ok: true,
          arrayBuffer: async () => new Uint8Array([1]).buffer,
        }),
        tiling: {
          bounds: [0, 0, 2, 2],
          dimensions: [20, 20],
          rows: 2,
          cols: 2,
        },
      },
    );

    assert.equal(params.length, 4);
    assert.equal(JSON.stringify(params[0].region.bounds), '[0,0,1,1]');
    assert.equal(warpArgs[warpArgs.length - 1], filename);
    assert.equal(fs.readFileSync(filename, 'utf8'), 'merged');
    assert.deepEqual(fs.readdirSync(outdir), ['water_20240101.tif']);
  } finally {
    if (previousEe === undefined) delete global.ee;
    else global.ee = previousEe;
    if (previousHost === undefined) delete global._host;
    else global._host = previousHost;
    fs.rmSync(outdir, { recursive: true, force: true });
  }
});

test('export_col 支持自定义并发并注册 gee-helper 异步任务', async () => {
  const previousPrint = global.print;
  const previousHost = global._host;
  const host = { pendingPrints: [] };
  global._host = host;
  const started = [];
  const exported = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  global.print = () => {};

  try {
    const pending = localExport.export_col({
      collection: mockCollection(
        ['a', 'b', 'c'],
        ['2024-01-01', '2024-01-02', '2024-01-03'].map(Date.parse),
      ),
      exportImage: async (group) => {
        started.push(group.key);
        await gate;
        exported.push(group.key);
      },
      concurrency: 2,
      outdir: '/tmp/out',
      log: false,
    });

    assert.equal(host.pendingPrints[0], pending);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(started.join(','), '20240101,20240102');
    release();
    await pending;
    assert.equal(exported.sort().join(','), '20240101,20240102,20240103');
  } finally {
    if (previousPrint === undefined) delete global.print;
    else global.print = previousPrint;
    if (previousHost === undefined) delete global._host;
    else global._host = previousHost;
  }
});

test('export_col 按 properties 写出通用影像记录', async () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-scene-record-'));
  const filename = path.join(outdir, 'scenes.csv');
  const previousEe = global.ee;
  const properties = ['system:index', 'system:time_start', 'SENSOR'];
  const collection = mockCollection(
    ['scene_1', 'scene_2'],
    ['2024-01-01', '2024-01-02'].map(Date.parse),
  );
  collection.reduceColumns = (reducer, received) => {
    assert.deepEqual(reducer, { count: properties.length });
    assert.deepEqual(received, properties);
    return {
      get(property) {
        assert.equal(property, 'list');
        return {
          evaluate(callback) {
            callback([
              ['scene_1', Date.parse('2024-01-01T00:00:00Z'), 'S2A'],
              ['scene_2', Date.parse('2024-01-02T00:00:00Z'), 'L8, test'],
            ]);
          },
        };
      },
    };
  };
  global.ee = {
    Reducer: { toList: (count) => ({ count }) },
  };
  let exported = 0;

  try {
    await localExport.export_col({
      collection,
      sceneRecord: { filename, properties },
      maxGroups: 0,
      exportImage: async () => { exported += 1; },
      outdir,
      log: false,
    });
    assert.equal(exported, 0);
    assert.equal(
      fs.readFileSync(filename, 'utf8'),
      'system:index,datetime_utc,SENSOR\n' +
        'scene_1,2024-01-01T00:00:00.000Z,S2A\n' +
        'scene_2,2024-01-02T00:00:00.000Z,"L8, test"\n',
    );
  } finally {
    if (previousEe === undefined) delete global.ee;
    else global.ee = previousEe;
    fs.rmSync(outdir, { recursive: true, force: true });
  }
});

test('export_col 默认并发数为 4', async () => {
  const started = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const dates = ['01', '02', '03', '04', '05'];
  const pending = localExport.export_col({
    collection: mockCollection(
      dates,
      dates.map((day) => Date.parse('2024-01-' + day + 'T00:00:00Z')),
    ),
    exportImage: async (group) => {
      started.push(group.key);
      await gate;
    },
    outdir: '/tmp/out',
    log: false,
  });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(
    started.join(','),
    '20240101,20240102,20240103,20240104',
  );
  release();
  await pending;
});

test('export_col 支持 8d、1m、1y 分组', async () => {
  const indices = ['a', 'b', 'c', 'd', 'e'];
  const timestamps = [
    '2024-01-01',
    '2024-01-08',
    '2024-01-09',
    '2024-02-01',
    '2025-01-01',
  ].map(Date.parse);

  async function groupsFor(period) {
    const groups = [];
    await localExport.export_col({
      collection: mockCollection(indices, timestamps),
      period,
      maxGroups: -1,
      prefix: 'water_',
      concurrency: 1,
      exportImage: async (group) => groups.push(group),
      outdir: '/tmp/out',
      log: false,
    });
    return groups;
  }

  assert.equal(JSON.stringify(await groupsFor('8d')), JSON.stringify([
    { key: '20240101_8d', name: 'water_20240101_8d', indices: ['a', 'b'] },
    { key: '20240109_8d', name: 'water_20240109_8d', indices: ['c'] },
    { key: '20240125_8d', name: 'water_20240125_8d', indices: ['d'] },
    { key: '20250101_8d', name: 'water_20250101_8d', indices: ['e'] },
  ]));
  assert.equal(JSON.stringify(await groupsFor('1m')), JSON.stringify([
    { key: '202401', name: 'water_202401', indices: ['a', 'b', 'c'] },
    { key: '202402', name: 'water_202402', indices: ['d'] },
    { key: '202501', name: 'water_202501', indices: ['e'] },
  ]));
  assert.equal(JSON.stringify(await groupsFor('1y')), JSON.stringify([
    { key: '2024', name: 'water_2024', indices: ['a', 'b', 'c', 'd'] },
    { key: '2025', name: 'water_2025', indices: ['e'] },
  ]));
});

test('export_col 直接下载给定分组', async () => {
  const groups = [
    { key: 'a', name: 'water_a', indices: ['i1'] },
    { key: 'b', name: 'water_b', indices: ['i2'] },
  ];
  const exported = [];
  await localExport.export_col({
    collection: {},
    groups,
    exportImage: async (group) => exported.push(group.key),
    outdir: '/tmp/out',
    log: false,
  });
  assert.deepEqual(exported, ['a', 'b']);
});

test('export_col 可从 system:index 保留卫星标识', async () => {
  const groups = [];
  await localExport.export_col({
    collection: mockCollection(
      ['scene_a_S2B', 'scene_b_L8', 'scene_c_S2B'],
      ['2023-06-01', '2023-06-01', '2023-06-01'].map(Date.parse),
    ),
    prefix: 'DSWX_water_fraction_',
    suffixPattern: /_([^_]+)$/,
    exportImage: async (group) => groups.push(group),
    outdir: '/tmp/out',
    log: false,
  });

  assert.equal(JSON.stringify(groups), JSON.stringify([
    {
      key: '20230601_S2B',
      name: 'DSWX_water_fraction_20230601_S2B',
      indices: ['scene_a_S2B', 'scene_c_S2B'],
    },
    {
      key: '20230601_L8',
      name: 'DSWX_water_fraction_20230601_L8',
      indices: ['scene_b_L8'],
    },
  ]));
});

test('export_col 拒绝非法周期', async () => {
  await assert.rejects(
    localExport.export_col({ collection: {}, period: 'weekly' }),
    /period 须为 Nd、Nm 或 Ny/,
  );
});

test('export_col 向宿主传播异步失败', async () => {
  const previousHost = global._host;
  const previousExitCode = process.exitCode;
  global._host = { pendingPrints: [] };

  try {
    const pending = localExport.export_col({ collection: {}, period: 'weekly' });
    assert.equal(global._host.pendingPrints[0], pending);
    await assert.rejects(pending, /period 须为 Nd、Nm 或 Ny/);
    assert.equal(process.exitCode, 1);
  } finally {
    if (previousHost === undefined) delete global._host;
    else global._host = previousHost;
    process.exitCode = previousExitCode;
  }
});

// Sentinel-1：中国250 m格点逐年有效观测数，通过getDownloadURL分块下载。
// 本地运行：node bin/ee examples/SurfaceWater/china-s1-annual-availability-url.js

var scale = 250;
var crs = 'EPSG:4326';
var noData = -9999;
var bounds = [73, 18, 136, 54];
var china = ee.FeatureCollection('FAO/GAUL/2015/level0')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .geometry();
var source = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(china)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

function annualValidCount(year, targetRegion) {
  var start = ee.Date.fromYMD(year, 1, 1);
  var observations = source
    .filterBounds(targetRegion)
    .filterDate(start, start.advance(1, 'year'))
    .select('VV');
  return ee.Image(ee.Algorithms.If(
    observations.size().gt(0),
    observations.count(),
    ee.Image.constant(0),
  ))
    .rename('valid_count')
    .unmask(0)
    .toInt16()
    .clip(china)
    .reproject({ crs: crs, scale: scale })
    .set({ year: year, 'system:time_start': start.millis() });
}

/** 本地gee-helper：按年分块下载，全部成功后才生成最终文件。 */
if (typeof module !== 'undefined') {
  var fs = require('node:fs');
  var path = require('node:path');
  var pkg = require('../../dist/index.js');
  var scriptDir = __dirname;
  var startYear = Number(process.env.START_YEAR || 2015);
  var endYear = Number(process.env.END_YEAR || 2025);
  var yearConcurrency = Number(process.env.CONCURRENCY || 1);
  var tileConcurrency = Number(process.env.TILE_CONCURRENCY || 4);
  var tileSize = Number(process.env.TILE_SIZE || 8);
  var outdir = process.env.OUTDIR || path.join(
    scriptDir,
    '..',
    '..',
    'data',
    'china_s1_annual_availability_250m',
  );

  function makeTile(id, tileBounds, depth) {
    return {
      id: id,
      bounds: tileBounds,
      depth: depth,
      region: ee.Geometry.Rectangle(tileBounds, crs, false),
    };
  }

  function makeTiles() {
    var rows = Math.ceil((bounds[3] - bounds[1]) / tileSize);
    var cols = Math.ceil((bounds[2] - bounds[0]) / tileSize);
    var tiles = [];
    for (var row = 0; row < rows; row += 1) {
      for (var col = 0; col < cols; col += 1) {
        var tileBounds = [
          bounds[0] + col * tileSize,
          bounds[1] + row * tileSize,
          Math.min(bounds[0] + (col + 1) * tileSize, bounds[2]),
          Math.min(bounds[1] + (row + 1) * tileSize, bounds[3]),
        ];
        tiles.push(makeTile(
          String(row).padStart(2, '0') + '_' +
            String(col).padStart(2, '0'),
          tileBounds,
          0,
        ));
      }
    }
    return tiles;
  }

  function splitTile(tile) {
    var x0 = tile.bounds[0];
    var y0 = tile.bounds[1];
    var x1 = tile.bounds[2];
    var y1 = tile.bounds[3];
    var xm = (x0 + x1) / 2;
    var ym = (y0 + y1) / 2;
    return [
      [x0, y0, xm, ym],
      [xm, y0, x1, ym],
      [x0, ym, xm, y1],
      [xm, ym, x1, y1],
    ].map(function (tileBounds, i) {
      return makeTile(tile.id + '_' + i, tileBounds, tile.depth + 1);
    });
  }

  async function runConcurrent(items, concurrency, task) {
    var cursor = 0;
    var results = new Array(items.length);
    async function worker() {
      while (cursor < items.length) {
        var index = cursor;
        cursor += 1;
        results[index] = await task(items[index]);
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(concurrency, items.length) },
      worker,
    ));
    return results;
  }

  async function exportTile(year, tile, tileDir) {
    var tileFile = path.join(tileDir, year + '_' + tile.id + '.tif');
    if (fs.existsSync(tileFile)) return [tileFile];

    try {
      var image = annualValidCount(year, tile.region).unmask(noData, false);
      await pkg.export_img(
        image,
        tileFile,
        { outdir: tileDir, region: tile.region, retries: 5 },
      );
      return [tileFile];
    } catch (error) {
      var message = error instanceof Error ? error.message : String(error);
      var splittable = /User memory limit exceeded|request.*too large|grid dimensions/i
        .test(message);
      if (!splittable || tile.depth >= 3) throw error;
      console.log('拆分：' + tile.id + '（层级' + (tile.depth + 1) + '）');
      var files = [];
      var children = splitTile(tile);
      for (var i = 0; i < children.length; i += 1) {
        files = files.concat(await exportTile(year, children[i], tileDir));
      }
      return files;
    }
  }

  async function exportYear(year) {
    var filename = path.join(
      outdir,
      'China_S1_IW_VVVH_valid_count_' + year + '_250m.tif',
    );
    if (fs.existsSync(filename)) {
      console.log('跳过：' + path.basename(filename));
      return;
    }

    var tiles = makeTiles();
    var tileDir = path.join(outdir, '.tiles-' + year);
    console.log('[year] ' + year + '：' + tiles.length + '个初始分块');
    var groups = await runConcurrent(
      tiles,
      tileConcurrency,
      function (tile) { return exportTile(year, tile, tileDir); },
    );
    var tileFiles = groups.flat();

    var partial = filename + '.partial.tif';
    fs.rmSync(partial, { force: true });
    _host.gdalWarp([
      '-q', '-overwrite', '-t_srs', crs,
      '-te', bounds[0], bounds[1], bounds[2], bounds[3],
      '-r', 'near',
      '-srcnodata', noData, '-dstnodata', noData, '-ot', 'Int16',
      '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=2',
    ].concat(tileFiles, [partial]).map(String));
    fs.renameSync(partial, filename);
    fs.rmSync(tileDir, { recursive: true, force: true });
    console.log('完成：' + path.basename(filename));
  }

  async function main() {
    var years = Array.from(
      { length: endYear - startYear + 1 },
      function (_, i) { return startYear + i; },
    );
    console.log('[annual] ' + years.join(', ') + '；年份并发：' +
      yearConcurrency + '；分块并发：' + tileConcurrency);
    await runConcurrent(years, yearConcurrency, exportYear);
  }

  _host.pendingPrints.push(main());
}

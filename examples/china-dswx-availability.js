// OPERA DSWx-HLS：中国 1/24° 网格逐年有效观测数。
// 每个网格取中心点；BWTR 为 0/1 时计为一个有效数值。
var china = ee.FeatureCollection('FAO/GAUL/2015/level0')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .geometry();
var bounds = [73, 18, 136, 54];
var region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);
var cellsize = 1 / 24;
var gridTransform = [cellsize, 0, bounds[0], 0, -cellsize, bounds[3]];
var source = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS');

function validObservation(image) {
  var water = image.select('BWTR_Binary_water');
  return water.lt(252)
    .rename('valid')
    .toFloat()
    .setDefaultProjection('EPSG:4326', gridTransform)
    .copyProperties(image, ['system:time_start']);
}

function emptyCount() {
  return ee.Image.constant(0)
    .rename('valid')
    .updateMask(ee.Image(0))
    .reproject({
      crs: 'EPSG:4326',
      crsTransform: gridTransform,
    });
}

function annualValidCount(year, targetRegion) {
  var start = ee.Date.fromYMD(year, 1, 1);
  var end = start.advance(1, 'year');
  var observations = source
    .filterBounds(targetRegion)
    .filterDate(start, end)
    .map(validObservation);
  var annual = ee.Image(ee.Algorithms.If(
    observations.size().gt(0),
    observations.sum(),
    emptyCount(),
  )).rename('annual_valid_count');
  // 数据覆盖：2023-04 至 2026-08；首尾年仅除以实际覆盖月份数。
  var monthCount = ({ 2023: 9, 2024: 12, 2025: 12, 2026: 8 })[year] || 12;
  var monthly = annual.divide(monthCount).rename('mean_monthly_valid_count');

  return annual.addBands(monthly)
    .toFloat()
    .clip(china)
    .unmask(-9999, false)
    .set({ year: year, month_count: monthCount });
}

/** 本地 gee-helper：以上为标准 GEE JavaScript。 */
if (typeof module !== 'undefined') {
  var fs = require('node:fs');
  var path = require('node:path');
  var pkg = require('../dist/index.js');
  var startYear = Number(process.env.START_YEAR || 2023);
  var endYear = Number(process.env.END_YEAR || 2026);
  var outdir = process.env.OUTDIR || path.join(
    __dirname,
    '..',
    'data',
    'china_dswx_valid_count_5km',
  );
  var concurrency = Number(process.env.CONCURRENCY || 4);

  function makeTiles() {
    var tiles = [];
    for (var row = 0; row < 4; row += 1) {
      for (var col = 0; col < 7; col += 1) {
        var tileBounds = [
          bounds[0] + col * 9,
          bounds[1] + row * 9,
          bounds[0] + (col + 1) * 9,
          bounds[1] + (row + 1) * 9,
        ];
        tiles.push({
          id: String(row).padStart(2, '0') + '_' +
            String(col).padStart(2, '0'),
          region: ee.Geometry.Rectangle(tileBounds, 'EPSG:4326', false),
        });
      }
    }
    return tiles;
  }

  async function runConcurrent(items, task) {
    var cursor = 0;
    async function worker() {
      while (cursor < items.length) {
        var item = items[cursor];
        cursor += 1;
        await task(item);
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(concurrency, items.length) },
      worker,
    ));
  }

  async function exportYear(year) {
    var filename = path.join(
      outdir,
      'China_DSWX_valid_count_' + year + '_1-24deg.tif',
    );
    if (fs.existsSync(filename)) {
      console.log('跳过：' + path.basename(filename));
      return;
    }

    var tileDir = path.join(outdir, '.tiles-' + year);
    var tiles = makeTiles();
    console.log('[year] ' + year + '：28 个 9° × 9° 分块');
    await runConcurrent(tiles, async function (tile) {
      var tileFile = path.join(tileDir, year + '_' + tile.id + '.tif');
      var image = annualValidCount(year, tile.region);
      await pkg.export_img(image, tileFile, {
        outdir: tileDir,
        region: tile.region,
      });
    });

    var tileFiles = tiles.map(function (tile) {
      return path.join(tileDir, year + '_' + tile.id + '.tif');
    });
    _host.gdalWarp([
      '-q', '-overwrite', '-t_srs', 'EPSG:4326',
      '-te', bounds[0], bounds[1], bounds[2], bounds[3],
      '-ts', 1512, 864, '-r', 'near',
      '-srcnodata', -9999, '-dstnodata', -9999, '-ot', 'Float32',
      '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
    ].concat(tileFiles, [filename]).map(String));
    fs.rmSync(tileDir, { recursive: true, force: true });
    console.log('完成：' + path.basename(filename));
  }

  async function main() {
    for (var year = startYear; year <= endYear; year += 1) {
      await exportYear(year);
    }
  }

  _host.pendingPrints.push(main());
}

// OPERA DSWx-HLS：中国 1/24° 网格逐月有效观测日数。
// 每个网格取中心点；同日所有卫星和 granule 合并，BWTR 为 0/1 时计为有效。
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
  return water.eq(0).or(water.eq(1))
    .rename('valid')
    .toFloat();
}

function emptyValid() {
  return ee.Image.constant(0)
    .rename('valid')
    .toFloat()
    .updateMask(ee.Image.constant(0));
}

function monthlyValidDays(year, month, targetRegion) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end = start.advance(1, 'month');
  var observations = source
    .filterBounds(targetRegion)
    .filterDate(start, end);
  var offsets = ee.List.sequence(0, end.difference(start, 'day').subtract(1));
  var daily = ee.ImageCollection.fromImages(offsets.map(function (offset) {
    var day = start.advance(offset, 'day');
    var subset = observations.filterDate(day, day.advance(1, 'day'));
    return ee.Image(ee.Algorithms.If(
      subset.size().gt(0),
      subset.map(validObservation).max(),
      emptyValid(),
    )).rename('valid').toFloat();
  }));

  return daily.sum()
    .rename('monthly_valid_days')
    .toInt16()
    .clip(china)
    .unmask(-9999, false)
    .setDefaultProjection({
      crs: 'EPSG:4326',
      crsTransform: gridTransform,
    })
    .set({ year: year, month: month });
}

/** 本地 gee-helper：以上为标准 GEE JavaScript。 */
if (typeof module !== 'undefined') {
  var fs = require('node:fs');
  var pkg = require('../../dist/index.js');
  var path = pkg.path;
  var startYear = Number(process.env.START_YEAR || 2023);
  var endYear = Number(process.env.END_YEAR || 2026);
  var periodConcurrency = Number(process.env.CONCURRENCY || 1);
  var tileConcurrency = Number(process.env.TILE_CONCURRENCY || 4);
  var tileSize = Number(process.env.TILE_SIZE || 4.5);
  var requestedMonths = process.env.MONTHS
    ? process.env.MONTHS.split(',').map(Number)
    : null;
  var outdir = process.env.OUTDIR || path.join(
    __dirname,
    '..',
    '..',
    'data',
    'china_dswx_valid_days_5km',
    'monthly',
  );

  function coveredMonths(year) {
    var first = year === 2023 ? 4 : 1;
    var last = year === 2026 ? 8 : 12;
    return Array.from({ length: last - first + 1 }, function (_, i) {
      return first + i;
    }).filter(function (month) {
      return !requestedMonths || requestedMonths.includes(month);
    });
  }

  function makeTiles() {
    var tiles = [];
    var rows = (bounds[3] - bounds[1]) / tileSize;
    var cols = (bounds[2] - bounds[0]) / tileSize;
    if (!Number.isInteger(rows) || !Number.isInteger(cols)) {
      throw new Error('TILE_SIZE 必须同时整除 36° 和 63°');
    }
    for (var row = 0; row < rows; row += 1) {
      for (var col = 0; col < cols; col += 1) {
        var tileBounds = [
          bounds[0] + col * tileSize,
          bounds[1] + row * tileSize,
          bounds[0] + (col + 1) * tileSize,
          bounds[1] + (row + 1) * tileSize,
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

  async function runConcurrent(items, concurrency, task) {
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

  async function exportPeriod(period) {
    var ym = String(period.year) + String(period.month).padStart(2, '0');
    var filename = path.join(
      outdir,
      'China_DSWX_valid_days_' + ym + '_1-24deg.tif',
    );
    if (fs.existsSync(filename)) {
      console.log('跳过：' + path.basename(filename));
      return;
    }

    var tileDir = path.join(outdir, '.tiles-' + ym);
    var tiles = makeTiles();
    console.log('[month] ' + ym + '：' + tiles.length + ' 个 ' +
      tileSize + '° × ' + tileSize + '° 分块');
    await runConcurrent(tiles, tileConcurrency, async function (tile) {
      var tileFile = path.join(tileDir, ym + '_' + tile.id + '.tif');
      await pkg.export_img(
        monthlyValidDays(period.year, period.month, tile.region),
        tileFile,
        { outdir: tileDir, region: tile.region, retries: 5 },
      );
    });

    var tileFiles = tiles.map(function (tile) {
      return path.join(tileDir, ym + '_' + tile.id + '.tif');
    });
    _host.gdalWarp([
      '-q', '-overwrite', '-t_srs', 'EPSG:4326',
      '-te', bounds[0], bounds[1], bounds[2], bounds[3],
      '-ts', 1512, 864, '-r', 'near',
      '-srcnodata', -9999, '-dstnodata', -9999, '-ot', 'Int16',
      '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
    ].concat(tileFiles, [filename]).map(String));
    fs.rmSync(tileDir, { recursive: true, force: true });
    console.log('完成：' + path.basename(filename));
  }

  async function main() {
    var periods = [];
    for (var year = startYear; year <= endYear; year += 1) {
      coveredMonths(year).forEach(function (month) {
        periods.push({ year: year, month: month });
      });
    }
    console.log('[monthly] ' + periods.length + ' 个月；月份并发：' +
      periodConcurrency + '；分块并发：' + tileConcurrency);
    await runConcurrent(periods, periodConcurrency, exportPeriod);
  }

  main();
}

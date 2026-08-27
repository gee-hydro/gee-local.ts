// OPERA DSWx-HLS：中国 1/24° 网格逐月有效观测日数。
// 同日所有卫星和 granule 合并，BWTR 为 0/1 时计为有效。
var bounds = [73, 18, 136, 54];
var cellsize = 1 / 24;
var noData = -9999;
var crs = 'EPSG:4326';
var china = ee.FeatureCollection('FAO/GAUL/2015/level0')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .geometry();
var region = ee.Geometry.Rectangle(bounds, crs, false);
var source = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS');

function validObservation(image) {
  var water = image.select('BWTR_Binary_water');
  return water.eq(0).or(water.eq(1)).rename('valid').toFloat();
}

function emptyValid() {
  return ee.Image.constant(0).rename('valid').toFloat()
    .updateMask(ee.Image.constant(0));
}

function monthlyValidDays(images, key) {
  var start = ee.Date.parse('yyyyMM', key);
  var end = start.advance(1, 'month');
  var observations = ee.ImageCollection(images);
  var offsets = ee.List.sequence(0, end.difference(start, 'day').subtract(1));
  var daily = ee.ImageCollection.fromImages(offsets.map(function (offset) {
    var day = start.advance(offset, 'day');
    var subset = observations.filterDate(day, day.advance(1, 'day'));
    return ee.Image(ee.Algorithms.If(
      subset.size().gt(0),
      subset.map(validObservation).max(),
      emptyValid()
    )).rename('valid').toFloat();
  }));

  return daily.sum()
    .rename('monthly_valid_days')
    .toInt16()
    .clip(china)
    .unmask(noData, false)
    .setDefaultProjection({
      crs: crs,
      crsTransform: [cellsize, 0, bounds[0], 0, -cellsize, bounds[3]]
    });
}

/** 本地 gee-helper：以上为标准 GEE JavaScript。 */
if (typeof module !== 'undefined') {
  var pkg = require('gee-helper');
  var startYear = Number(process.env.START_YEAR || 2023);
  var endYear = Number(process.env.END_YEAR || 2026);
  var concurrency = Number(process.env.CONCURRENCY || 1);
  var tileConcurrency = Number(process.env.TILE_CONCURRENCY || 4);
  var outdir = process.env.OUTDIR ||
    './data/china_dswx_valid_days_5km/monthly';
  var collection = source
    .filterBounds(region)
    .filterDate(startYear + '-01-01', (endYear + 1) + '-01-01');
  var tiling = {
    bounds: bounds,
    dimensions: [1512, 864],
    rows: 8,
    cols: 14,
    concurrency: tileConcurrency,
    resampling: 'near',
    srcNoData: noData,
    dstNoData: noData,
    dataType: 'Int16'
  };

  function exportImage(group) {
    var images = collection.filter(
      ee.Filter.inList('system:index', group.indices)
    );
    var image = monthlyValidDays(images, group.key);
    var filename = outdir + '/' + group.name + '_1-24deg.tif';
    return pkg.export_img_grids(image, filename, {
      outdir: outdir,
      cellsize: cellsize,
      crs: crs,
      retries: 5,
      tiling: tiling
    });
  }

  pkg.export_col(collection, {
    prefix: 'China_DSWX_valid_days_',
    period: '1m',
    concurrency: concurrency,
    exportImage: exportImage
  });
}

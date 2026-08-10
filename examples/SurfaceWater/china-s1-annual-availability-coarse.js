// Sentinel-1：中国0.25°格点逐年有效观测数，用于全国尺度制图。
// 本地运行：node bin/ee examples/SurfaceWater/china-s1-annual-availability-coarse.js

var crs = 'EPSG:4326';
var step = 0.25;
var noData = -9999;
var extent = [73, 18, 136, 54];
var transform = [step, 0, extent[0], 0, -step, extent[3]];
var bounds = ee.Geometry.Rectangle(extent, crs, false);
var china = ee.FeatureCollection('FAO/GAUL/2015/level0')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .geometry();
var source = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(china)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

function annualValidCount(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  return source.filterDate(start, start.advance(1, 'year'))
    .select('VV')
    .count()
    .rename('valid_count')
    .unmask(0)
    .toInt16()
    .clip(china)
    .reproject({ crs: crs, crsTransform: transform })
    .set({ year: year, 'system:time_start': start.millis() });
}

if (typeof module !== 'undefined') {
  var path = require('node:path');
  var pkg = require('../../dist/index.js');
  var startYear = Number(process.env.START_YEAR || 2015);
  var endYear = Number(process.env.END_YEAR || 2025);
  var outdir = path.resolve('data/china_s1_annual_availability_025deg');

  _host.pendingPrints.push((async function () {
    for (var year = startYear; year <= endYear; year += 1) {
      var filename = path.join(
        outdir,
        'China_S1_IW_VVVH_valid_count_' + year + '_025deg.tif',
      );
      await pkg.export_img(
        annualValidCount(year).unmask(noData, false),
        filename,
        { outdir: outdir, region: bounds, retries: 3 },
      );
    }
  }()));
}

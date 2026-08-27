// Sentinel-1：中国0.25°格点逐年有效观测数，用于全国尺度制图。
// 本地运行：node bin/ee examples/SurfaceWater/china-s1-annual-availability-coarse.js

var cellsize = 0.25;
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

function annualValidCount(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  return source.filterDate(start, start.advance(1, 'year'))
    .select('VV')
    .count()
    .rename('valid_count')
    .unmask(0)
    .toInt16()
    .clip(china)
    .set({ year: year, 'system:time_start': start.millis() });
}

if (typeof module !== 'undefined') {
  var pkg = require('gee-helper');
  var startYear = Number(process.env.START_YEAR || 2015);
  var endYear = Number(process.env.END_YEAR || 2025);
  var outdir = './data/china_s1_annual_availability_025deg';

  function exportImage(group) {
    var year = Number(group.key);
    var img = annualValidCount(year).unmask(noData, false);
    var filename = outdir + '/China_S1_IW_VVVH_valid_count_' +
      year + '_025deg.tif';
    return pkg.export_img(img, filename, {
        outdir: outdir,
        bounds: bounds,
        cellsize: cellsize,
        retries: 3,
      },
    );
  }
  pkg.export_col(
    source.filterDate(startYear + '-01-01', (endYear + 1) + '-01-01'),
    { period: '1y', concurrency: 1, exportImage: exportImage },
  );
}

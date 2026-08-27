// Sentinel-1：中国 250 m 格点逐年有效观测数。
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

function annualValidCount(images) {
  return ee.ImageCollection(images)
    .select('VV')
    .count()
    .rename('valid_count')
    .unmask(0)
    .toInt16()
    .clip(china)
    .unmask(noData, false);
}

/** 本地 gee-helper：以上为标准 GEE JavaScript。 */
if (typeof module !== 'undefined') {
  var pkg = require('gee-helper');
  var startYear = Number(process.env.START_YEAR || 2015);
  var endYear = Number(process.env.END_YEAR || 2025);
  var outdir = 'data/china_s1_annual_availability_250m';
  var collection = source.filterDate(
    startYear + '-01-01',
    (endYear + 1) + '-01-01'
  );
  var tiling = {
    bounds: bounds,
    rows: 8,
    cols: 14,
    concurrency: 4,
    resampling: 'near',
    srcNoData: noData,
    dstNoData: noData,
    dataType: 'Int16'
  };

  function exportImage(group) {
    var images = collection.filter(
      ee.Filter.inList('system:index', group.indices)
    );
    var filename = outdir + '/' + group.name + '_250m.tif';
    return pkg.export_img_grids(annualValidCount(images), filename, {
      outdir: outdir,
      scale: scale,
      crs: crs,
      retries: 5,
      tiling: tiling
    });
  }

  pkg.export_col(collection, {
    prefix: 'China_S1_IW_VVVH_valid_count_',
    period: '1y',
    concurrency: 1,
    exportImage: exportImage
  });
}

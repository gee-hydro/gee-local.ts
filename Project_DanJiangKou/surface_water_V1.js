// OPERA DSWx-HLS：按研究区有效观测比例筛选并下载丹江口水体比例。
// https://developers.google.com/earth-engine/datasets/catalog/OPERA_DSWX_L3_V1_HLS

/** GEE JavaScript */
// 丹江口水库 OSM 边界外扩约 2 km，避免岸线被截断。
var region = ee.Geometry.Rectangle(
  [110.67, 32.42, 111.73, 33.07],
  'EPSG:4326',
  false,
);
// WGS84 局部网格，1/1200°为名义 90 m 分辨率。
var gridTransform = [
  1 / 1200, 0, 110.67,
  0, -1 / 1200, 33.07,
];
var minValidFraction = 0.9;
var qualityScale = 500;
var collection = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2020-01-01', '2027-01-01')
  // .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

function mosaicWater_HLS(images) {
  var projection = ee.Image(images.first())
    .select('BWTR_Binary_water')
    .projection();
  return images.map(function (image) {
    var binary = image.select('BWTR_Binary_water');
    return binary.eq(1)
      .updateMask(binary.lt(252))
      .toFloat();
  }).mosaic().setDefaultProjection(projection);
}

function aggWaterFrac_HLS(images, options) {
  return mosaicWater_HLS(images)
    .reduceResolution({
      reducer: ee.Reducer.mean(),
      maxPixels: 1024,
    })
    .reproject({
      crs: 'EPSG:4326',
      crsTransform: options.targetTransform,
    })
    .rename('water_fraction')
    .unmask(-9999, false)
    .clip(options.targetRegion);
}

/** 本地 gee-helper */
var path = require('node:path');
var localExport = require('../src/export/export.js');
var util = require('../src/export/utilize.js');
var qualityFilter = require('../src/export/qualityFilter.js');

var outdir = path.join(__dirname, 'data', 'surface_water_2020-2026_valid90_90m');
var f_quality_all = process.env.QUALITY_FILE ||
  path.join(outdir, 'DSWX_daily_all.csv');
var f_quality_sel = process.env.SELECTED_FILE ||
  path.join(outdir, 'DSWX_daily_selected.csv');
var exportOptions = {
  region: region,
  collection: collection,
  outdir: outdir,
  maxGroups: Number(process.env.MAX_GROUPS || -1),
  concurrency: 4,
  period: '1d',
  prefix: 'DSWX_water_fraction_',
  suffixPattern: /_([^_]+)$/,
  buildImage: aggWaterFrac_HLS,
  buildImageOptions: {
    targetRegion: region,
    targetTransform: gridTransform,
  },
};

async function main() {
  util.mkpath(outdir);
  var groups = await localExport.listGroups(exportOptions);
  console.time('[quality] qualityFilter');
  var selected = await qualityFilter(groups, {
    collection: collection,
    allFile: f_quality_all,
    selectedFile: f_quality_sel,
    concurrency: exportOptions.concurrency,
    buildImage: mosaicWater_HLS,
    qualityName: 'frac_valid',
    minQuality: minValidFraction,
    qualityOptions: {
      targetRegion: region,
      qualityScale: qualityScale,
    },
  });
  console.timeEnd('[quality] qualityFilter');
  if (process.env.QUALITY_ONLY) return;
  await localExport.export_col(Object.assign({}, exportOptions, {
    groups: selected,
    maxGroups: -1,
  }));
}

var mainPromise = main();
if (globalThis._host && Array.isArray(globalThis._host.pendingPrints)) {
  globalThis._host.pendingPrints.push(mainPromise);
}

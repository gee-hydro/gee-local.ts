// OPERA DSWx-HLS：按研究区有效观测比例筛选并下载丹江口水体比例。
// https://developers.google.com/earth-engine/datasets/catalog/OPERA_DSWX_L3_V1_HLS

var pkg_resample = require('src/export/resample.js');

function mosaicWater_HLS(images) {
  return images.map(function (image) {
    var binary = image.select('BWTR_Binary_water');
    return binary.eq(1)
      .updateMask(binary.lt(252))
      .toFloat();
  }).mosaic();
}

function aggWaterFrac_HLS(images, options) {
  var mosaic = mosaicWater_HLS(images);
  return pkg_resample.resample(mosaic, options)
    .rename('water_fraction')
    .unmask(-9999, false)
    .clip(options.region);
}

/** MAIN JavaScript */
// 丹江口水库 OSM 边界外扩约 2 km，避免岸线被截断。
var bounds = [110.67, 32.42, 111.73, 33.07];
var region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);

var cellsize_target = 1 / 1200;
var resample_options = pkg_resample.resampleOptions(bounds, cellsize_target);

var minValidFraction = Number(process.env.MIN_VALID_FRACTION || 0.9);
var qualityScale = 500;

var col = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2023-01-01', '2027-01-01') // begin from 20230404
  // .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

/** 本地 gee-helper */
var path = require('node:path');
var localExport = require('../src/export/export.js');
var util = require('../src/export/utilize.js');
var col_frac_valid = require('../dist/export/frac_valid.js');

var outdir = process.env.OUTDIR ||
  path.join(__dirname, 'data', 'surface_water_2020-2026_valid90_90m');
util.mkpath(outdir);

var prefix = 'DSWX_water_fraction_';
var exportOptions = {
  region: region,
  outdir: outdir,
  prefix: prefix,
  suffixPattern: /_([^_]+)$/, // system:index`..._S2B` → `_S2B`
  maxGroups: Number(process.env.MAX_GROUPS || -1),
  period: '1d',
  buildImage: aggWaterFrac_HLS,
  buildImageOptions: resample_options,
};

async function main() {
  var groups = await localExport.listGroups(col, exportOptions);

  console.time('[quality] col_frac_valid');
  var selected = await col_frac_valid(col, groups, {
    outdir: outdir,
    prefix: prefix,
    buildImage: mosaicWater_HLS,
    qualityOptions: {
      targetRegion: region,
      qualityScale: qualityScale,
      minQuality: minValidFraction,
    },
  });
  console.timeEnd('[quality] col_frac_valid');
  if (process.env.QUALITY_ONLY) return;

  await localExport.export_col(col, Object.assign({}, exportOptions, {
    groups: selected,
    maxGroups: -1,
  }));
}

main();

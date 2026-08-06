// OPERA DSWx-HLS：按研究区有效观测比例筛选并下载丹江口水体比例。
// https://developers.google.com/earth-engine/datasets/catalog/OPERA_DSWX_L3_V1_HLS

function makeCrsTransform(bounds, cellsize) {
  return [
    cellsize, 0, bounds[0],
    0, -cellsize, bounds[3],
  ];
}

function buildOptions(bounds, region, cellsize_target) {
  // WGS84 局部网格：源数据名义 30 m，输出名义 90 m。
  var cellsize_source = 1 / 3600;
  return {
    crs: 'EPSG:4326',
    region: region,
    crsTransform_source: makeCrsTransform(bounds, cellsize_source),
    crsTransform_target: makeCrsTransform(bounds, cellsize_target),
  }
}

function resample(image, options) {
  mosaic = mosaic.setDefaultProjection(
    ee.Projection(options.crs),
    options.crsTransform_source,
  ); // ! 必须指定，mosaic之后projection信息丢失

  return mosaic
    .reduceResolution({
      reducer: ee.Reducer.mean(),
      maxPixels: 1024,
    })
    .reproject({
      crs: 'EPSG:4326',
      crsTransform: options.crsTransform_target,
    });
}

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
  return resample(mosaic, options)
    .rename('water_fraction')
    .unmask(-9999, false)
    .clip(options.region)
}

/** GEE JavaScript */
// 丹江口水库 OSM 边界外扩约 2 km，避免岸线被截断。
var bounds = [110.67, 32.42, 111.73, 33.07];
var region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);

var cellsize_target = 1 / 1200;
var buildImageOptions = buildOptions(bounds, region, cellsize_target);

var minValidFraction = 0.9;
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
var qualityFilter = require('../src/export/qualityFilter.js');

var outdir = path.join(__dirname, 'data', 'surface_water_2020-2026_valid90_90m');
var f_quality_all = process.env.QUALITY_FILE || path.join(outdir, 'DSWX_daily_all.csv');
var f_quality_sel = process.env.SELECTED_FILE || path.join(outdir, 'DSWX_daily_selected.csv');

var exportOptions = {
  region: region,
  collection: col,
  outdir: outdir,
  maxGroups: Number(process.env.MAX_GROUPS || -1),
  concurrency: 4,
  period: '1d',
  prefix: 'DSWX_water_fraction_',
  suffixPattern: /_([^_]+)$/,
  buildImage: aggWaterFrac_HLS,
  buildImageOptions: buildImageOptions,
};

async function main() {
  util.mkpath(outdir);
  var groups = await localExport.listGroups(exportOptions);

  console.time('[quality] qualityFilter');
  var selected = await qualityFilter(groups, {
    collection: col,
    allFile: f_quality_all,
    selectedFile: f_quality_sel,
    concurrency: exportOptions.concurrency,
    buildImage: mosaicWater_HLS,
    qualityOptions: {
      targetRegion: region,
      qualityScale: qualityScale,
      minQuality: minValidFraction,
    },
  });
  console.timeEnd('[quality] qualityFilter');
  if (process.env.QUALITY_ONLY) return;

  await localExport.export_col(Object.assign({}, exportOptions, {
    groups: selected,
    maxGroups: -1,
  }));
}

main();

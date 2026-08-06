// OPERA DSWx-HLS：按研究区有效观测比例筛选并下载丹江口水体比例。
// https://developers.google.com/earth-engine/datasets/catalog/OPERA_DSWX_L3_V1_HLS

var pkg = require('../dist/index.js');

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
  return pkg.resample(mosaic, options)
    .rename('water_fraction')
    .unmask(-9999, false)
    .clip(options.region);
}

/** MAIN JavaScript */
// 丹江口水库 OSM 边界外扩约 2 km，避免岸线被截断。
var bounds = [110.67, 32.42, 111.73, 33.07];
var region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);

var cellsize_target = 1 / 1200;
var resample_options = pkg.resampleOptions(bounds, cellsize_target);

var minValidFraction = Number(process.env.MIN_VALID_FRACTION || 0.9);
var qualityScale = 500;

var col = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2023-01-01', '2027-01-01') // begin from 20230404
  // .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

/** 本地 gee-helper */
var outdir = process.env.OUTDIR ||
  pkg.path.join(__dirname, 'data', 'surface_water_2020-2026_valid90_90m');
pkg.mkpath(outdir);

var prefix = 'DSWX_water_fraction_';
var group_options = {
  prefix: prefix,
  suffixPattern: /_([^_]+)$/, // system:index`..._S2B` → `_S2B`
  maxGroups: Number(process.env.MAX_GROUPS || -1),
  period: '1d',
};
var download_options = {
  outdir: outdir,
  region: region,
};
function exportImage(group) {
  var source = col.filter(ee.Filter.inList('system:index', group.indices));
  var image = aggWaterFrac_HLS(source, resample_options);
  var filename = pkg.path.join(outdir, group.name + '.tif');
  return pkg.export_img(image, filename, download_options);
}

async function main() {
  var groups = await pkg.listGroups(col, group_options);

  console.time('[quality] col_frac_valid');
  var selected = await pkg.col_frac_valid(col, groups, {
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

  await pkg.export_col(col, {
    groups: selected,
    exportImage: exportImage,
    concurrency: 4,
  });
}

main();

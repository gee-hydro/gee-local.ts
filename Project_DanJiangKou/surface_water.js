// OPERA DSWx-HLS：逐景下载 2020—2026 年 6—8 月丹江口水体比例。
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
var collection = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2020-01-01', '2027-01-01')
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

function aggWater_HLS(images, options) {
  var projection = ee.Image(images.first())
    .select('BWTR_Binary_water')
    .projection();
  var water = images.map(function (image) {
    var binary = image.select('BWTR_Binary_water');
    return binary.eq(1)
      .updateMask(binary.lt(252))
      .toFloat();
  }).mosaic().setDefaultProjection(projection);

  return water
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
var localExport = require('users/kongdd/pkg:export.js');

function groupScenes(indices) {
  var groups = {};
  indices.forEach(function (index) {
    var match = index.match(/_(\d{8})T\d{6}Z_.*_([^_]+)$/);
    var key = match ? match[1] + '_' + match[2] : index;
    if (!groups[key]) groups[key] = [];
    groups[key].push(index);
  });
  return Object.keys(groups).map(function (key) {
    return { key: key, indices: groups[key] };
  });
}

function getName(group) {
  return 'DSWX_water_fraction_' + group.key.replace(/[^A-Za-z0-9._-]+/g, '_');
}

function getSource(group, options) {
  return options.collection.filter(
    ee.Filter.inList('system:index', group.indices),
  );
}

var outputDir = path.join(__dirname, 'data', 'surface_water_2020-2026_JJA_90m');
var localOptions = {
  region: region,
  collection: collection,
  outputDir: outputDir,
  maxScenes: Number(process.env.MAX_SCENES || 0),
  concurrency: Number(process.env.CONCURRENCY || 4),
  summary: '2020—2026 年 6—8 月原始瓦片数：',
  groupLabel: '逐景文件数',
  groupScenes: groupScenes,
  getName: getName,
  getSource: getSource,
  buildImage: aggWater_HLS,
  buildImageOptions: {
    targetRegion: region,
    targetTransform: gridTransform,
  },
  getDownloadUrl: _host.getDownloadUrl,
  host: _host,
};

localExport.export_col(localOptions);

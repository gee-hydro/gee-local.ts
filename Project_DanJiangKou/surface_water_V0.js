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
  .filter(ee.Filter.lt('CLOUD_COVERAGE', 20))
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
var pkg = require('../dist/index.js');

var outdir = pkg.path.join(__dirname, 'data', 'surface_water_2020-2026_JJA_90m');
var build_options = {
  targetRegion: region,
  targetTransform: gridTransform,
};
var group_options = {
  prefix: 'DSWX_water_fraction_',
  suffixPattern: /_([^_]+)$/,
  maxGroups: Number(process.env.MAX_GROUPS || -1),
  period: '1d',
};
var download_options = { outdir: outdir, region: region };
function exportImage(group) {
  var source = collection.filter(ee.Filter.inList('system:index', group.indices));
  var image = aggWater_HLS(source, build_options);
  var filename = pkg.path.join(outdir, group.name + '.tif');
  return pkg.export_img(image, filename, download_options);
}

var taskInfo = {
  filename: pkg.path.join(outdir, 'DSWX_scenes_cloud_lt20.csv'),
  properties: [
    'system:index',
    'system:time_start',
    'SENSOR',
    'SPACECRAFT_NAME',
    'CLOUD_COVERAGE',
    'INPUT_HLS_PRODUCT_CLOUD_COVERAGE',
  ],
};

async function main() {
  var groups = await pkg.listGroups(collection, group_options);
  await pkg.export_col(collection, {
    groups: groups,
    concurrency: 4,
    sceneRecord: taskInfo,
    exportImage: exportImage,
  });
}

main();

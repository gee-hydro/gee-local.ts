// DynamicWorld：逐景下载 2020—2022 年 6—8 月丹江口水体比例。
// OPERA DSWx-HLS 始于2023年；此前数据使用同源Sentinel-2的Dynamic World补充。
// https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1

/** GEE JavaScript */
var region = ee.Geometry.Rectangle(
  [110.67, 32.42, 111.73, 33.07],
  'EPSG:4326',
  false,
);
var startYear = 2020;
var endYear = 2022;
var waterThreshold = 0.5;
var landThreshold = 0.2;

// WGS84 局部网格，1/1200°为名义 90 m 分辨率。
var gridTransform = [
  1 / 1200, 0, 110.67,
  0, -1 / 1200, 33.07,
];
var collection = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(String(startYear) + '-01-01', String(endYear + 1) + '-01-01')
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

function aggWater_DynamicWorld(images, options) {
  var projection = ee.Image(images.first()).select('water').projection();
  var water = images.map(function (image) {
    // 达到水体阈值记为水体，低于陆地阈值记为非水体；中间值视为不确定。
    var probability = image.select('water');
    var valid = probability.gte(options.minWater)
      .or(probability.lte(options.maxLand));
    return probability.gte(options.minWater)
      .updateMask(valid)
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

var outdir = pkg.path.join(
  __dirname,
  'data',
  'surface_water_' + startYear + '-' + endYear + '_JJA_90m_dynamic_world',
);
var build_options = {
  targetRegion: region,
  targetTransform: gridTransform,
  minWater: waterThreshold,
  maxLand: landThreshold,
};
var group_options = {
  prefix: 'DW_water_fraction_',
  period: '1d',
};
var download_options = { outdir: outdir, region: region };
function exportImage(group) {
  var source = collection.filter(ee.Filter.inList('system:index', group.indices));
  var image = aggWater_DynamicWorld(source, build_options);
  var filename = pkg.path.join(outdir, group.name + '.tif');
  return pkg.export_img(image, filename, download_options);
}

async function main() {
  var groups = await pkg.listGroups(collection, group_options);
  await pkg.export_col(collection, {
    groups: groups,
    exportImage: exportImage,
  });
}

main();

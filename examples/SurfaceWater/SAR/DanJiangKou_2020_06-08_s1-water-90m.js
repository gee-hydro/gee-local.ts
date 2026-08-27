// 丹江口水库 2020 年 6—8 月 Sentinel-1 SAR 水体：完整库区外扩 10 km，输出 90 m。
// 本地运行：node bin/ee examples/SurfaceWater/danjiangkou-2020-06-08-s1-water-90m.js

var s1 = require('./s1-water.js');
var geojson = JSON.parse(require('node:fs').readFileSync(
  './data/regions/danjiangkou-reservoir.geojson',
  'utf8',
));
var reservoir = ee.Geometry(geojson.features[0].geometry);
var crs = 'EPSG:32649';
var exportBounds = [445680, 3576960, 576990, 3675510];
var region = ee.Geometry.Rectangle(exportBounds, crs, false);
var acquisitions = [
  ['2020-06-05', 84],
  ['2020-06-17', 84],
  ['2020-07-18', 11],
  ['2020-07-23', 84],
  ['2020-07-30', 11],
  ['2020-08-04', 84],
  ['2020-08-11', 11],
  ['2020-08-23', 11],
];
var slope = ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003'))
  .clipToBoundsAndScale({ geometry: region, scale: 30 });
var waterCollection = s1.collection(
  s1.source(region, '2020-06-01', '2020-09-01'),
  acquisitions,
  { region: region, thresholdMask: slope.lt(5), terrainMask: slope.lt(20) },
);

print('完整库区面积（km²）', reservoir.area(30).divide(1e6));
print('日期', waterCollection.aggregate_array('date'));
print('Otsu 阈值（dB）', waterCollection.aggregate_array('otsu_threshold_db'));
Map.centerObject(reservoir, 9);
Map.addLayer(
  ee.Image(waterCollection.filterDate('2020-07-18', '2020-07-19').first())
    .selfMask(),
  { palette: ['#1976D2'] },
  '2020-07-18 水体（90 m）',
);
Map.addLayer(
  ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(reservoir)]), 1, 1),
  { palette: ['#D32F2F'] },
  '丹江口水库边界',
);

if (typeof module !== 'undefined') {
  s1.export90m(waterCollection, {
    outdir: './data/danjiangkou_2020_06_08_s1_water_90m',
    prefix: 'Danjiangkou_S1_',
    region: region,
    crs: crs,
    exportBounds: exportBounds,
  });
}

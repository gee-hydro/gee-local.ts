// 十堰市 2020 年 8 月 Sentinel-1 SAR 水体，先在原始尺度识别，再聚合到 90 m。
// 本地运行：node bin/ee examples/SurfaceWater/shiyan-2020-08-s1-water-90m.js

var s1 = require('./s1-water.js');
var crs = 'EPSG:32649';
var exportBounds = [354150, 3482550, 553140, 3682620];
var acquisitions = [
  ['2020-08-04', 84],
  ['2020-08-11', 11],
  ['2020-08-16', 84],
  ['2020-08-23', 11],
  ['2020-08-28', 84],
];
var regionFeatures = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM1_NAME', 'Hubei Sheng'))
  .filter(ee.Filter.eq('ADM2_NAME', 'Shiyan'));
var region = regionFeatures.geometry();
var processingRegion = region.buffer(90);
var slopeMask = ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003'))
  .lt(5)
  .clipToBoundsAndScale({ geometry: processingRegion, scale: 30 });
var source = s1.source(region, '2020-08-01', '2020-09-01');
var waterCollection = s1.collection(source, acquisitions, {
  region: region,
  clip: processingRegion,
  thresholdMask: slopeMask,
  terrainMask: slopeMask,
});

print('源影像数', source.size());
print('日期', waterCollection.aggregate_array('date'));
print('相对轨道', waterCollection.aggregate_array('orbit'));
print('Otsu 阈值（dB）', waterCollection.aggregate_array('otsu_threshold_db'));
Map.centerObject(region, 8);
Map.addLayer(
  ee.Image(waterCollection.first()).selfMask(),
  { palette: ['#1976D2'] },
  '2020-08-04 水体（90 m）',
);
Map.addLayer(
  ee.Image().byte().paint(regionFeatures, 1, 2),
  { palette: ['#303030'] },
  '十堰市界',
);

if (typeof module !== 'undefined') {
  s1.export90m(waterCollection, {
    outdir: './data/shiyan_2020_08_s1_water_90m',
    prefix: 'Shiyan_S1_',
    region: region,
    crs: crs,
    exportBounds: exportBounds,
  });
}

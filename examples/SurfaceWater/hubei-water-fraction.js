// 湖北省 1/120° 水体比例与水体范围（JRC GSW v1.4，1984—2021 年）。
// 水体定义：seasonality >= 2；1/120° 网格中 frac_water > 0.5 判定为水体。
// 本地运行：node bin/ee examples/hubei-water-fraction.js

var crs = 'EPSG:4326';
var gridTransform = [1 / 120, 0, -180, 0, -1 / 120, 90];
var seasonalityThreshold = 2;
var waterFractionThreshold = 0.5;
var noData = -9999;

var hubeiFeatures = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Hubei Sheng'));
var hubei = hubeiFeatures.geometry();

var water30m = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
  .select('seasonality')
  .gte(seasonalityThreshold)
  .unmask(0);
var fracWater = water30m
  .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 2048 })
  .reproject({ crs: crs, crsTransform: gridTransform })
  .clip(hubei)
  .rename('frac_water');
var waterExtent = fracWater
  .gt(waterFractionThreshold)
  .rename('water')
  .toByte();
var exportImage = fracWater
  .addBands(waterExtent)
  .toFloat()
  .unmask(noData, false);

Map.centerObject(hubei, 7);
Map.addLayer(
  fracWater,
  { min: 0, max: 1, palette: ['#F7FBFF', '#6BAED6', '#08306B'] },
  '1/120° 水体比例',
);
Map.addLayer(
  waterExtent.selfMask(),
  { min: 1, max: 1, palette: ['#1769AA'] },
  '水体范围（frac_water > 0.5）',
);
Map.addLayer(
  ee.Image().byte().paint(hubeiFeatures, 1, 2),
  { palette: ['#303030'] },
  '湖北省界',
);

Export.image.toDrive({
  image: exportImage,
  description: 'Hubei_JRC_GSW_water_fraction_1over120deg',
  fileNamePrefix: 'Hubei_JRC_GSW_seasonality_ge2_water_1over120deg',
  region: hubei,
  crs: crs,
  crsTransform: gridTransform,
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF',
  formatOptions: { cloudOptimized: true, noData: noData },
});

/** 本地 gee-helper：下载 GeoTIFF 并绘图；以上代码可直接复制到 Code Editor。 */
if (typeof module !== 'undefined') {
  var childProcess = require('node:child_process');
  var pkg = require('gee-helper');
  var outdir = './data/hubei_water_fraction';
  var filename = outdir +
    '/Hubei_JRC_GSW_seasonality_ge2_water_1over120deg.tif';

  async function saveLocal() {
    await pkg.export_img(exportImage, filename, {
      outdir: outdir,
      region: hubei,
    });
    childProcess.execFileSync(
      'gdal_edit.py',
      ['-a_nodata', String(noData), filename],
      { stdio: 'inherit' },
    );
    childProcess.execFileSync(
      process.env.RSCRIPT || '/opt/miniforge3/envs/r4.5/bin/Rscript',
      [
        './examples/SurfaceWater/plot-hubei-water-fraction.R',
        filename,
        './images/hubei-frac-water-1over120deg.png',
        './images/hubei-water-extent-frac-gt-0.5.png',
      ],
      { stdio: 'inherit' },
    );
  }

  saveLocal();
}

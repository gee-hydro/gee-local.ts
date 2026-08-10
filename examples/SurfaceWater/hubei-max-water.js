// 湖北省 JRC GSW v1.4 最大水体范围（1984—2021 年，1/120°）。
// 数据目录：https://developers.google.com/earth-engine/datasets/catalog/JRC_GSW1_4_GlobalSurfaceWater?hl=zh-cn
// 本地运行：node bin/ee examples/hubei-max-water.js

var hubeiFeatures = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Hubei Sheng'));
var hubei = hubeiFeatures.geometry();

// 30 m 二值数据聚合至 1/120°（约 1 km）；任一源像元为水体即保留。
var gridTransform = [1 / 120, 0, -180, 0, -1 / 120, 90];
var maxWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater')
  .select('max_extent')
  .unmask(0)
  .reduceResolution({ reducer: ee.Reducer.max(), maxPixels: 2048 })
  .reproject({ crs: 'EPSG:4326', crsTransform: gridTransform })
  .clip(hubei)
  .rename('max_water_extent')
  .toByte();
var exportImage = maxWater.unmask(255, false);

Map.centerObject(hubei, 7);
Map.addLayer(
  maxWater.selfMask(),
  { min: 1, max: 1, palette: ['#1769AA'] },
  '最大水体范围（1984—2021 年）',
);
Map.addLayer(
  ee.Image().byte().paint(hubeiFeatures, 1, 2),
  { palette: ['#303030'] },
  '湖北省界',
);

Export.image.toDrive({
  image: exportImage,
  description: 'Hubei_JRC_GSW_max_extent_1over120deg',
  fileNamePrefix: 'Hubei_JRC_GSW_max_extent_1984_2021_1over120deg',
  region: hubei,
  crs: 'EPSG:4326',
  crsTransform: gridTransform,
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF',
  formatOptions: { cloudOptimized: true, noData: 255 },
});

/** 本地 gee-helper：下载 GeoTIFF 并绘图；以上代码可直接复制到 Code Editor。 */
if (typeof module !== 'undefined') {
  var childProcess = require('node:child_process');
  var pkg = require('../dist/index.js');
  var outdir = './data/hubei_max_water';
  var filename = outdir +
    '/Hubei_JRC_GSW_max_extent_1984_2021_1over120deg.tif';

  async function saveLocal() {
    await pkg.export_img(exportImage, filename, {
      outdir: outdir,
      region: hubei,
    });

    // getDownloadURL 对 Byte GeoTIFF 默认写入 NoData=0，修正为导出约定的 255。
    childProcess.execFileSync(
      'gdal_edit.py',
      ['-a_nodata', '255', filename],
      { stdio: 'inherit' },
    );
    childProcess.execFileSync(
      process.env.RSCRIPT || '/opt/miniforge3/envs/r4.5/bin/Rscript',
      [
        './examples/SurfaceWater/plot-hubei-max-water.R',
        filename,
        './images/hubei-max-water-extent-1over120deg.png',
      ],
      { stdio: 'inherit' },
    );
  }

  saveLocal();
}

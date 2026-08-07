// 秦皇岛市最新可用 Landsat 7/8/9 地表温度。
// 可在 GEE Code Editor 或本地 gee-helper 中运行。
// Landsat 7/8/9 L2：https://developers.google.com/earth-engine/datasets/catalog/LANDSAT_LE07_C02_T1_L2
// 本地验证：node bin/ee examples/qinhuangdao-latest-lst.js

// https://code.earthengine.google.com/2d9abf8a7f8b17c260b8741fec6ebf83

var city = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Hebei Sheng'))
  .filter(ee.Filter.eq('ADM2_NAME', 'Qinhuangdao'))
  .geometry();

var start = ee.Date('2023-01-01');
var end = ee.Date(Date.now());

function landsatLST(image, thermalBand) {
  var qa = image.select('QA_PIXEL');
  // QA_PIXEL bits 0—5：填充值、膨胀云、卷云、云、云影、积雪。
  var clear = qa.bitwiseAnd(63).eq(0)
    .and(image.select('QA_RADSAT').eq(0));
  return image.select(thermalBand)
    .multiply(0.00341802)
    .add(149)
    .subtract(273.15)
    .rename('LST_C')
    .updateMask(clear)
    .copyProperties(image, [
      'system:time_start',
      'LANDSAT_PRODUCT_ID',
      'SPACECRAFT_ID',
      'CLOUD_COVER',
    ]);
}

function addValidFraction(image) {
  var fraction = image.mask().reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: city,
    scale: 300,
    maxPixels: 1e7,
    tileScale: 2,
  }).get('LST_C');
  return image.set('frac_valid', fraction);
}

var landsat7 = ee.ImageCollection('LANDSAT/LE07/C02/T1_L2')
  .filterBounds(city)
  .filterDate(start, end)
  .filter(ee.Filter.eq('PROCESSING_LEVEL', 'L2SP'))
  .map(function (image) {
    return landsatLST(image, 'ST_B6');
  });
var landsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(city)
  .filterDate(start, end)
  .filter(ee.Filter.eq('PROCESSING_LEVEL', 'L2SP'))
  .map(function (image) {
    return landsatLST(image, 'ST_B10');
  });
var landsat9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
  .filterBounds(city)
  .filterDate(start, end)
  .filter(ee.Filter.eq('PROCESSING_LEVEL', 'L2SP'))
  .map(function (image) {
    return landsatLST(image, 'ST_B10');
  });

var landsat = landsat7.merge(landsat8).merge(landsat9)
  .map(addValidFraction)
  .filter(ee.Filter.gte('frac_valid', 0.2))
  .sort('system:time_start', false);

var latestLST = ee.Image(landsat.first());

var lstVis = {
  min: -10,
  max: 45,
  palette: [
    '#9270DB', '#0204C9', '#4169E7', '#80A9F0', '#ACE3EA', '#9AECD4',
    '#E6C999', '#F8D11C', '#FFAC00', '#FF4C00', '#B42221', '#FFB2B2',
  ],
};

Map.centerObject(city, 9);
Map.addLayer(latestLST.clip(city), lstVis, 'Landsat 7/8/9 最新地表温度 (°C)');
Map.addLayer(
  ee.Image().byte().paint(city, 1, 2),
  { palette: ['ffffff'] },
  '秦皇岛市界',
);

print('Landsat 候选影像数', landsat.size());
print('最新 Landsat 日期', latestLST.date().format('yyyy-MM-dd'));
print('卫星', latestLST.get('SPACECRAFT_ID'));
print('产品 ID', latestLST.get('LANDSAT_PRODUCT_ID'));
print('秦皇岛有效像元比例', latestLST.get('frac_valid'));
print(ui.Chart.image.histogram({
  image: latestLST,
  region: city,
  scale: 30,
  maxBuckets: 60,
}).setOptions({
  title: '秦皇岛市最新 Landsat 7/8/9 地表温度分布',
  hAxis: { title: '地表温度 (°C)' },
  vAxis: { title: '像元数' },
  legend: { position: 'none' },
}));

/** 本地 gee-helper：保存 90 m GeoTIFF；以上代码可直接复制到 Code Editor。 */
if (typeof module !== 'undefined') {
  var path = require('node:path');
  var childProcess = require('node:child_process');
  var pkg = require('../dist/index.js');
  var scriptDir = __dirname;
  var outdir = path.join(scriptDir, '..', 'data', 'qinhuangdao_lst');

  async function saveLocal() {
    var date = await pkg.getInfo(latestLST.date().format('yyyyMMdd'));
    var filename = path.join(
      outdir,
      'Qinhuangdao_Landsat_LST_' + date + '_90m.tif',
    );
    var image = latestLST
      .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 16 })
      .reproject({ crs: 'EPSG:4326', scale: 90 })
      .clip(city)
      .unmask(-9999, false);
    await pkg.export_img(image, filename, { outdir: outdir, region: city });

    childProcess.execFileSync(
      process.env.RSCRIPT || '/opt/miniforge3/envs/r4.5/bin/Rscript',
      [
        path.join(scriptDir, 'plot-qinhuangdao-lst.R'),
        filename,
        path.join(scriptDir, '..', 'images', 'qinhuangdao-latest-lst.png'),
      ],
      { stdio: 'inherit' },
    );
  }

  _host.pendingPrints.push(saveLocal());
}

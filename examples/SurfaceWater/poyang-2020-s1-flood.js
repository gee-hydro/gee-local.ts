// 鄱阳湖区 2020 年洪水 Sentinel-1 SAR 识别试验。
// 对比同轨 Sentinel-1B：洪水前 2020-06-20，洪峰期 2020-07-14。
// 本地运行：node bin/ee examples/SurfaceWater/poyang-2020-s1-flood.js

var region = ee.Geometry.Rectangle([115.78, 28.36, 116.75, 29.75]);
var before = ee.Image(
  'COPERNICUS/S1_GRD/S1B_IW_GRDH_1SDV_20200620T101816_20200620T101851_022116_029F8B_298B',
);
var flood = ee.Image(
  'COPERNICUS/S1_GRD/S1B_IW_GRDH_1SDV_20200714T101817_20200714T101852_022466_02AA36_A270',
);

function otsu(histogram) {
  histogram = ee.Dictionary(histogram);
  var counts = ee.Array(histogram.get('histogram'));
  var means = ee.Array(histogram.get('bucketMeans'));
  var size = ee.Number(means.length().get([0]));
  var total = counts.reduce(ee.Reducer.sum(), [0]).get([0]);
  var sum = means.multiply(counts)
    .reduce(ee.Reducer.sum(), [0]).get([0]);
  var mean = sum.divide(total);
  var scores = ee.List.sequence(1, size.subtract(1)).map(function (i) {
    var aCounts = counts.slice(0, 0, i);
    var aCount = aCounts.reduce(ee.Reducer.sum(), [0]).get([0]);
    var aMean = means.slice(0, 0, i)
      .multiply(aCounts)
      .reduce(ee.Reducer.sum(), [0]).get([0])
      .divide(aCount);
    var bCount = total.subtract(aCount);
    var bMean = sum.subtract(aCount.multiply(aMean)).divide(bCount);
    return aCount.multiply(aMean.subtract(mean).pow(2))
      .add(bCount.multiply(bMean.subtract(mean).pow(2)));
  });
  return means.slice(0, 0, size.subtract(1)).sort(scores).get([-1]);
}

function sarScore(image) {
  return image.select(['VV', 'VH'])
    .focalMedian({ radius: 30, units: 'meters' })
    .reduce(ee.Reducer.mean())
    .rename('sar');
}

function threshold(image) {
  var histogram = image.reduceRegion({
    reducer: ee.Reducer.histogram(255, 0.1),
    geometry: region,
    scale: 30,
    maxPixels: 1e8,
    tileScale: 4,
  }).get('sar');
  return ee.Number(otsu(histogram));
}

function areaKm2(mask) {
  return ee.Number(ee.Image.pixelArea().rename('area').updateMask(mask)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: region,
      scale: 30,
      maxPixels: 1e8,
      tileScale: 4,
    }).get('area')).divide(1e6);
}

var beforeSar = sarScore(before);
var floodSar = sarScore(flood);
var beforeThreshold = threshold(beforeSar);
var floodThreshold = threshold(floodSar);
var valid = beforeSar.mask().and(floodSar.mask())
  .and(ee.Terrain.slope(ee.Image('USGS/SRTMGL1_003')).lt(5));
var beforeWater = beforeSar.lt(beforeThreshold).and(valid);
var floodWater = floodSar.lt(floodThreshold).and(valid);
var inundation = floodWater.and(beforeWater.not())
  .and(floodWater.connectedPixelCount(100, true).gte(8))
  .rename('inundation');
var floodClass = floodWater.toByte().where(inundation, 2).rename('flood_class');

// JRC 月水体仅验证有有效 Landsat 观测的像元，不作为完整真值。
var jrc = ee.Image('JRC/GSW1_4/MonthlyHistory/2020_07').select('water');
var comparison = valid.and(jrc.neq(0));
var jrcWater = jrc.eq(2).and(comparison);
var sarWater = floodWater.and(comparison);
var intersection = sarWater.and(jrcWater);
var union = sarWater.or(jrcWater).and(comparison);

print('洪水前阈值（dB）', beforeThreshold);
print('洪峰期阈值（dB）', floodThreshold);
print('洪水前水体（km²）', areaKm2(beforeWater));
print('洪峰期水体（km²）', areaKm2(floodWater));
print('新增淹没（km²）', areaKm2(inundation));
print(
  'JRC 有效覆盖率（%）',
  areaKm2(comparison).divide(areaKm2(valid)).multiply(100),
);
print('SAR/JRC precision', areaKm2(intersection).divide(areaKm2(sarWater)));
print('SAR/JRC recall', areaKm2(intersection).divide(areaKm2(jrcWater)));
print('SAR/JRC IoU', areaKm2(intersection).divide(areaKm2(union)));

Map.centerObject(region, 8);
Map.addLayer(
  beforeSar,
  { min: -28, max: -5 },
  '洪水前 SAR（VV/VH均值）',
  false,
);
Map.addLayer(
  floodSar,
  { min: -28, max: -5 },
  '洪峰期 SAR（VV/VH均值）',
  false,
);
Map.addLayer(
  floodWater.selfMask(),
  { palette: ['#1976D2'] },
  '2020-07-14 水体',
);
Map.addLayer(
  inundation.selfMask(),
  { palette: ['#E64A19'] },
  '新增淹没候选区',
);

var noData = 255;
var exportImage = floodClass
  .clip(region)
  .reproject({ crs: 'EPSG:32650', scale: 30 })
  .unmask(noData, false)
  .toByte();

Export.image.toDrive({
  image: exportImage,
  description: 'Poyang_2020_S1_flood_class_30m',
  fileNamePrefix: 'Poyang_2020_S1_flood_class_20200714_30m',
  region: region,
  crs: 'EPSG:32650',
  scale: 30,
  maxPixels: 1e8,
  fileFormat: 'GeoTIFF',
  formatOptions: { cloudOptimized: true, noData: noData },
});

/** 本地 gee-helper：下载 GeoTIFF 并绘图；以上代码可直接复制到 Code Editor。 */
if (typeof module !== 'undefined') {
  var childProcess = require('node:child_process');
  var pkg = require('../../dist/index.js');
  var path = pkg.path;
  var scriptDir = __dirname;
  var root = path.join(scriptDir, '..', '..');
  var outdir = path.join(root, 'data', 'poyang_2020_s1_flood');
  var filename = path.join(
    outdir,
    'Poyang_2020_S1_flood_class_20200714_30m.tif',
  );

  async function saveLocal() {
    await pkg.export_img(exportImage, filename, {
      outdir: outdir,
      region: region,
      retries: 5,
    });
    childProcess.execFileSync(
      'gdal_edit.py',
      ['-a_nodata', String(noData), filename],
      { stdio: 'inherit' },
    );
    childProcess.execFileSync(
      process.env.RSCRIPT || '/opt/miniforge3/envs/r4.5/bin/Rscript',
      [
        path.join(scriptDir, 'plot-poyang-2020-s1-flood.R'),
        filename,
        path.join(root, 'images', 'poyang-2020-s1-flood.png'),
      ],
      { stdio: 'inherit' },
    );
  }

  saveLocal();
}

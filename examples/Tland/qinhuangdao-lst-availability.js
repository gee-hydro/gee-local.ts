// 秦皇岛市 2026 年 1—9 月 Landsat 7/8/9 地表温度可用数据。
var city = ee.FeatureCollection('FAO/GAUL/2015/level2')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Hebei Sheng'))
  .filter(ee.Filter.eq('ADM2_NAME', 'Qinhuangdao'))
  .geometry();
var start = '2026-01-01';
var end = '2026-10-01'; // filterDate 右端不包含

function landsatLST(image, thermalBand) {
  var qa = image.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(63).eq(0)
    .and(image.select('QA_RADSAT').eq(0));
  var cloud = qa.bitwiseAnd(30).neq(0).rename('cloud');
  return image.select(thermalBand)
    .multiply(0.00341802)
    .add(149)
    .subtract(273.15)
    .rename('LST_C')
    .updateMask(clear)
    .addBands(cloud)
    .copyProperties(image, [
      'system:time_start',
      'LANDSAT_PRODUCT_ID',
      'SPACECRAFT_ID',
      'CLOUD_COVER',
    ]);
}

function collection(id, thermalBand) {
  return ee.ImageCollection(id)
    .filterBounds(city)
    .filterDate(start, end)
    .filter(ee.Filter.eq('PROCESSING_LEVEL', 'L2SP'))
    .map(function (image) {
      return landsatLST(image, thermalBand);
    });
}

function addValidFraction(image) {
  var fractions = ee.Image.cat([
    image.select('LST_C').mask().rename('valid').unmask(0, false),
    image.select('cloud').unmask(0, false),
  ]).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: city,
    scale: 300,
    maxPixels: 1e7,
    tileScale: 2,
  });
  return image.set({
    date: image.date().format('yyyy-MM-dd'),
    frac_cloud: fractions.get('cloud'),
    frac_valid: fractions.get('valid'),
  });
}

var landsat7 = collection('LANDSAT/LE07/C02/T1_L2', 'ST_B6');
var landsat8 = collection('LANDSAT/LC08/C02/T1_L2', 'ST_B10');
var landsat9 = collection('LANDSAT/LC09/C02/T1_L2', 'ST_B10');
var available = landsat7.merge(landsat8).merge(landsat9)
  .map(addValidFraction)
  .filter(ee.Filter.gte('frac_valid', 0.2))
  .sort('system:time_start');
var properties = [
  'date',
  'SPACECRAFT_ID',
  'LANDSAT_PRODUCT_ID',
  'CLOUD_COVER',
  'frac_cloud',
  'frac_valid',
];
var rows = available.reduceColumns(
  ee.Reducer.toList(properties.length),
  properties,
).get('list');

print('Landsat 7 原始影像数', landsat7.size());
print('Landsat 8 原始影像数', landsat8.size());
print('Landsat 9 原始影像数', landsat9.size());
print('有效率 >= 0.2 的影像数', available.size());
print('可用影像', rows);

/** 本地 gee-helper：保存查询结果；以上代码可直接复制到 Code Editor。 */
if (typeof module !== 'undefined') {
  var fs = require('node:fs');
  var pkg = require('gee-helper');
  pkg.evaluate(rows).then(function (values) {
    var outdir = './data/qinhuangdao_lst';
    var filename = outdir + '/Landsat_LST_availability_202601-202609.csv';
    fs.mkdirSync(outdir, { recursive: true });
    fs.writeFileSync(filename, [properties].concat(values)
      .map(function (row) { return row.join(','); })
      .join('\n') + '\n');

    var monthly = {};
    values.forEach(function (row) {
      var month = row[0].slice(0, 7);
      monthly[month] = monthly[month] || [0, 0, 0];
      monthly[month][0] += 1;
      monthly[month][1] += row[4];
      monthly[month][2] += row[5];
    });
    var monthlyRows = Object.keys(monthly).sort().map(function (month) {
      var value = monthly[month];
      return [
        month,
        value[0],
        (value[1] / value[0]).toFixed(6),
        (value[2] / value[0]).toFixed(6),
      ];
    });
    var monthlyFile = outdir + '/Landsat_LST_monthly_202601-202609.csv';
    fs.writeFileSync(monthlyFile, [
      ['month', 'n', 'mean_frac_cloud', 'mean_frac_valid'],
    ].concat(monthlyRows).map(function (row) {
      return row.join(',');
    }).join('\n') + '\n');
    console.log('[availability] ' + filename);
    console.log('[monthly] ' + monthlyFile);
  });
}

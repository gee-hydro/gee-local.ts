// OPERA DSWx-HLS：逐景下载 2020—2026 年 6—8 月丹江口水体比例。
// https://developers.google.com/earth-engine/datasets/catalog/OPERA_DSWX_L3_V1_HLS

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
var outputDir = path.join(__dirname, 'data', 'surface_water_2020-2026_JJA_90m');
var maxScenes = Number(process.env.MAX_SCENES || 0);

var collection = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2020-01-01', '2027-01-01')
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

function aggregateWater(images) {
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
      crsTransform: gridTransform,
    })
    .rename('water_fraction')
    .unmask(-9999, false)
    .clip(region);
}

function getDownloadUrl(image, params) {
  return new Promise(function (resolve, reject) {
    image.getDownloadURL(params, function (url, error) {
      if (error) reject(new Error(String(error)));
      else resolve(url);
    });
  });
}

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


/** MAIN */
var fs = require('node:fs');
var path = require('node:path');

fs.mkdirSync(outputDir, { recursive: true });

async function downloadScene(group, position, total) {
  var name = 'DSWX_water_fraction_' + group.key.replace(/[^A-Za-z0-9._-]+/g, '_');
  var filename = path.join(outputDir, name + '.tif');
  if (fs.existsSync(filename)) {
    console.log('[' + position + '/' + total + '] 跳过：' + path.basename(filename));
    return;
  }

  var source = collection.filter(ee.Filter.inList('system:index', group.indices));
  var image = aggregateWater(source);
  var url = await getDownloadUrl(image, {
    name: name,
    region: region,
    format: 'GEO_TIFF',
    filePerBand: false,
  });
  var response = await fetch(url);
  if (!response.ok) throw new Error('HTTP ' + response.status + ': ' + group.key);
  fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
  console.log('[' + position + '/' + total + '] 完成：' + path.basename(filename));
}

print('2020—2026 年 6—8 月原始瓦片数：', collection.size());
var downloadPromise = new Promise(function (resolve, reject) {
  collection.aggregate_array('system:index').evaluate(function (indices, error) {
    if (error) {
      reject(new Error(String(error)));
      return;
    }

    var groups = groupScenes(indices);
    console.log('逐景文件数：' + groups.length);
    if (maxScenes > 0) groups = groups.slice(0, maxScenes);

    (async function () {
      for (var i = 0; i < groups.length; i += 1) {
        await downloadScene(groups[i], i + 1, groups.length);
      }
      console.log('下载完成：' + outputDir);
    })().then(resolve, reject);
  });
});

_host.pendingPrints.push(downloadPromise.catch(function (downloadError) {
  console.error('下载失败：', downloadError.message || downloadError);
  process.exitCode = 1;
}));

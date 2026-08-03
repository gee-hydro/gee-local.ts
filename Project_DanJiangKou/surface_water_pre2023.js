// Dynamic World：逐景下载 2020—2022 年 6—8 月丹江口水体比例。
// OPERA DSWx-HLS 始于2023年；此前数据使用同源Sentinel-2的Dynamic World补充。
// https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_DYNAMICWORLD_V1

var fs = require('node:fs');
var path = require('node:path');
var childProcess = require('node:child_process');

if (fs.existsSync('/usr/share/proj/proj.db')) {
  process.env.PROJ_DATA = '/usr/share/proj';
  process.env.PROJ_LIB = '/usr/share/proj';
  process.env.GTIFF_SRS_SOURCE = 'EPSG';
}

var region = ee.Geometry.Rectangle(
  [110.67, 32.42, 111.73, 33.07],
  'EPSG:4326',
  false,
);
var gridWidth = 1273;
var gridHeight = 781;
var gridBounds = [
  110.67,
  33.07 - gridHeight / 1200,
  110.67 + gridWidth / 1200,
  33.07,
];
var downloadRegion = ee.Geometry.Rectangle(gridBounds, 'EPSG:4326', false);
var tileRegions = [];
for (var row = 0; row < 2; row += 1) {
  for (var col = 0; col < 2; col += 1) {
    var x0 = gridBounds[0] + (gridBounds[2] - gridBounds[0]) * col / 2;
    var x1 = gridBounds[0] + (gridBounds[2] - gridBounds[0]) * (col + 1) / 2;
    var y0 = gridBounds[1] + (gridBounds[3] - gridBounds[1]) * row / 2;
    var y1 = gridBounds[1] + (gridBounds[3] - gridBounds[1]) * (row + 1) / 2;
    tileRegions.push(ee.Geometry.Rectangle([x0, y0, x1, y1], 'EPSG:4326', false));
  }
}
var startYear = Number(process.env.START_YEAR || 2020);
var endYear = Number(process.env.END_YEAR || 2022);
var outputDir = process.env.OUTPUT_DIR || path.join(
  __dirname,
  'data',
  'surface_water_' + startYear + '-' + endYear + '_JJA_90m_dynamic_world',
);
var maxScenes = Number(process.env.MAX_SCENES || 0);
var waterThreshold = Number(process.env.WATER_THRESHOLD || 0.5);
var landThreshold = Number(process.env.LAND_THRESHOLD || 0.2);

fs.mkdirSync(outputDir, { recursive: true });

var collection = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(region)
  .filterDate(String(startYear) + '-01-01', String(endYear + 1) + '-01-01')
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .sort('system:time_start');

function aggregateWater(images) {
  var projection = ee.Image(images.first()).select('water').projection();
  var water = images.map(function (image) {
    // 水体概率≥0.5记为水体，≤0.2记为非水体；中间值视为不确定。
    var probability = image.select('water');
    var valid = probability.gte(waterThreshold)
      .or(probability.lte(landThreshold));
    return probability.gte(waterThreshold)
      .updateMask(valid)
      .toFloat();
  }).mosaic().setDefaultProjection(projection);

  return water
    .clip(downloadRegion)
    .unmask(255, false)
    .toByte()
    .rename('water_binary');
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
    var match = index.match(/^(\d{8})T/);
    var key = match ? match[1] + '_S2' : index;
    if (!groups[key]) groups[key] = [];
    groups[key].push(index);
  });
  return Object.keys(groups).sort().map(function (key) {
    return { key: key, indices: groups[key] };
  });
}

async function downloadTile(image, group, directory, index) {
  var tileName = 'tile_' + index;
  var lastError = '';
  for (var attempt = 0; attempt < 5; attempt += 1) {
    var url = await getDownloadUrl(image, {
      name: tileName,
      region: tileRegions[index],
      format: 'GEO_TIFF',
      filePerBand: false,
    });
    var response = await fetch(url);
    if (response.ok) {
      var filename = path.join(directory, tileName + '.tif');
      fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
      return filename;
    }
    lastError = await response.text();
    if (response.status !== 429 && response.status !== 503) break;
    await new Promise(function (resolve) {
      setTimeout(resolve, 2000 * Math.pow(2, attempt));
    });
  }
  throw new Error(
    '下载失败：' + group.key + '/' + tileName + ': ' + lastError,
  );
}

async function downloadScene(group, position, total) {
  var name = 'DW_water_fraction_' + group.key;
  var filename = path.join(outputDir, name + '.tif');
  if (fs.existsSync(filename)) {
    console.log('[' + position + '/' + total + '] 跳过：' + path.basename(filename));
    return;
  }

  var source = collection.filter(ee.Filter.inList('system:index', group.indices));
  var image = aggregateWater(source);
  var temporary = fs.mkdtempSync(path.join(outputDir, '.tmp-' + group.key + '-'));
  try {
    var tiles = await Promise.all(tileRegions.map(function (_, index) {
      return downloadTile(image, group, temporary, index);
    }));
    var warpArgs = [
      '-q', '-overwrite', '-t_srs', 'EPSG:4326',
      '-te', String(gridBounds[0]), String(gridBounds[1]),
      String(gridBounds[2]), String(gridBounds[3]),
      '-ts', String(gridWidth), String(gridHeight),
      '-r', 'average', '-srcnodata', '255', '-dstnodata', '-9999',
      '-ot', 'Float32', '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
    ].concat(tiles, [filename]);
    childProcess.execFileSync('gdalwarp', warpArgs);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('[' + position + '/' + total + '] 完成：' + path.basename(filename));
}

print(startYear + '—' + endYear + ' 年 6—8 月 Dynamic World 原始瓦片数：', collection.size());
var downloadPromise = new Promise(function (resolve, reject) {
  collection.aggregate_array('system:index').evaluate(function (indices, error) {
    if (error) {
      reject(new Error(String(error)));
      return;
    }

    var groups = groupScenes(indices);
    console.log('逐日文件数：' + groups.length);
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

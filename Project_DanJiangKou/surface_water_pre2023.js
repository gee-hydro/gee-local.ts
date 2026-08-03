// Dynamic World：逐景下载 2020—2022 年 6—8 月丹江口水体比例。
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

function getCollection(targetRegion, firstYear, lastYear) {
  return ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterBounds(targetRegion)
    .filterDate(String(firstYear) + '-01-01', String(lastYear + 1) + '-01-01')
    .filter(ee.Filter.calendarRange(6, 8, 'month'))
    .sort('system:time_start');
}

var collection = getCollection(region, startYear, endYear);

function aggregateWater(images, options) {
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
    .clip(options.targetRegion)
    .unmask(255, false)
    .toByte()
    .rename('water_binary');
}

/** 本地 gee-helper */
var fs = require('node:fs');
var path = require('node:path');
var localExport = require('users/kongdd/pkg:export.js');

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

async function downloadTile(
  image,
  group,
  directory,
  index,
  tileRegion,
  options,
) {
  var tileName = 'tile_' + index;
  var lastError = '';
  for (var attempt = 0; attempt < 5; attempt += 1) {
    var url = await options.getDownloadUrl(image, {
      name: tileName,
      region: tileRegion,
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

async function downloadScene(group, position, total, options) {
  var name = 'DW_water_fraction_' + group.key;
  var filename = path.join(options.outputDir, name + '.tif');
  if (fs.existsSync(filename)) {
    console.log('[' + position + '/' + total + '] 跳过：' + path.basename(filename));
    return;
  }

  var source = options.collection.filter(
    ee.Filter.inList('system:index', group.indices),
  );
  var image = options.buildImage(source, options.buildImageOptions);
  var temporary = fs.mkdtempSync(
    path.join(options.outputDir, '.tmp-' + group.key + '-'),
  );
  try {
    var tiles = await Promise.all(options.tileRegions.map(function (tileRegion, index) {
      return downloadTile(
        image,
        group,
        temporary,
        index,
        tileRegion,
        options,
      );
    }));
    var warpArgs = [
      '-q', '-overwrite', '-t_srs', 'EPSG:4326',
      '-te', String(options.gridBounds[0]), String(options.gridBounds[1]),
      String(options.gridBounds[2]), String(options.gridBounds[3]),
      '-ts', String(options.gridWidth), String(options.gridHeight),
      '-r', 'average', '-srcnodata', '255', '-dstnodata', '-9999',
      '-ot', 'Float32', '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
    ].concat(tiles, [filename]);
    options.gdalWarp(warpArgs);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  console.log('[' + position + '/' + total + '] 完成：' + path.basename(filename));
}

var localStartYear = Number(process.env.START_YEAR || startYear);
var localEndYear = Number(process.env.END_YEAR || endYear);
var localWaterThreshold = Number(
  process.env.WATER_THRESHOLD || waterThreshold,
);
var localLandThreshold = Number(process.env.LAND_THRESHOLD || landThreshold);
var localCollection = getCollection(region, localStartYear, localEndYear);
var outputDir = process.env.OUTPUT_DIR || path.join(
  __dirname,
  'data',
  'surface_water_' + localStartYear + '-' + localEndYear +
    '_JJA_90m_dynamic_world',
);
var localOptions = {
  collection: localCollection,
  buildImage: aggregateWater,
  buildImageOptions: {
    targetRegion: downloadRegion,
    minWater: localWaterThreshold,
    maxLand: localLandThreshold,
  },
  tileRegions: tileRegions,
  gridBounds: gridBounds,
  gridWidth: gridWidth,
  gridHeight: gridHeight,
  outputDir: outputDir,
  maxScenes: Number(process.env.MAX_SCENES || 0),
  concurrency: Number(process.env.CONCURRENCY || 4),
  summary: localStartYear + '—' + localEndYear +
    ' 年 6—8 月 Dynamic World 原始瓦片数：',
  groupLabel: '逐日文件数',
  groupScenes: groupScenes,
  exportImage: downloadScene,
  getDownloadUrl: _host.getDownloadUrl,
  gdalWarp: _host.gdalWarp,
  host: _host,
};

localExport.export_col(localOptions);

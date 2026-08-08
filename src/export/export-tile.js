var fs = require('node:fs');
var path = require('node:path');

function makeTileRegions(tiling) {
  var ee = globalThis.ee;
  if (!ee || !ee.Geometry) {
    throw new Error('切片下载仅在 gee-helper 本地运行时可用');
  }

  var bounds = tiling.bounds;
  var rows = tiling.rows || 1;
  var cols = tiling.cols || 1;
  var regions = [];
  for (var row = 0; row < rows; row += 1) {
    for (var col = 0; col < cols; col += 1) {
      var x0 = bounds[0] + (bounds[2] - bounds[0]) * col / cols;
      var x1 = bounds[0] + (bounds[2] - bounds[0]) * (col + 1) / cols;
      var y0 = bounds[1] + (bounds[3] - bounds[1]) * row / rows;
      var y1 = bounds[1] + (bounds[3] - bounds[1]) * (row + 1) / rows;
      regions.push(ee.Geometry.Rectangle(
        [x0, y0, x1, y1],
        tiling.crs || 'EPSG:4326',
        false,
      ));
    }
  }
  return regions;
}

function mergeTiles(tiles, filename, tiling, host) {
  if (!host.gdalWarp) throw new Error('gdalWarp 仅在 gee-helper 本地运行时可用');
  var dimensions = tiling.dimensions;
  var bounds = tiling.bounds;
  var args = [
    '-q', '-overwrite', '-t_srs', tiling.crs || 'EPSG:4326',
    '-te', String(bounds[0]), String(bounds[1]),
    String(bounds[2]), String(bounds[3]),
    '-ts', String(dimensions[0]), String(dimensions[1]),
    '-r', tiling.resampling || 'average',
    '-srcnodata', String(tiling.srcNoData == null ? 255 : tiling.srcNoData),
    '-dstnodata', String(tiling.dstNoData == null ? -9999 : tiling.dstNoData),
    '-ot', tiling.dataType || 'Float32',
    '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE',
  ].concat(tiles, [filename]);
  host.gdalWarp(args);
}

async function mapConcurrent(items, concurrency, task) {
  var cursor = 0;
  var results = new Array(items.length);
  async function worker() {
    while (cursor < items.length) {
      var index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  ));
  return results;
}

async function exportTiles({
  downloadFile, filename, getDownloadParams, host, image, name, options,
}) {
  fs.mkdirSync(options.outdir, { recursive: true });
  var temporary = fs.mkdtempSync(
    path.join(options.outdir, '.tmp-' + name + '-'),
  );
  try {
    var regions = makeTileRegions(options.tiling);
    var concurrency = options.tiling.concurrency || regions.length;
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new Error('tiling.concurrency 须为正整数');
    }
    var tiles = await mapConcurrent(regions, concurrency, function (region, index) {
      var tileName = name + '_tile_' + index;
      var tileFile = path.join(temporary, tileName + '.tif');
      var params = getDownloadParams(tileName, region, options);
      return downloadFile(image, tileFile, options, params, host);
    });
    mergeTiles(tiles, filename, options.tiling, host);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = {
  exportTiles,
};

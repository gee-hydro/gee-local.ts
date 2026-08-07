// OPERA DSWx-HLS：筛选并下载丹江口水体比例。
var path = require('node:path');
var { SurfaceWater_HLS, ee } = require('../dist/index.js');

var bounds = [110.67, 32.42, 111.73, 33.07];
var region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);

const col = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2023-01-01', '2027-01-01')
  .sort('system:time_start');

var options = {
  bounds: bounds,
  outdir: process.env.OUTDIR || path.join(
    __dirname,
    'data',
    'surface_water_2020-2026_valid90_90m',
  ),
  maxGroups: Number(process.env.MAX_GROUPS || -1),
  minValidFraction: Number(process.env.MIN_VALID_FRACTION || 0.9),
};

async function main() {
  var groups = await SurfaceWater_HLS.frac_valid(col, options);
  if (process.env.QUALITY_ONLY) return;
  await SurfaceWater_HLS.download(col, { ...options, groups });
}

main();

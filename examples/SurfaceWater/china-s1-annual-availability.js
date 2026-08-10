// Sentinel-1：中国250 m格点逐年有效观测数。
// 每个格点取中心点；相邻scene重叠处可能重复计数。2014年仅含10月3日以后。
// Code Editor运行后，在Tasks中启动逐年Drive导出。

var startYear = 2015;
var endYear = 2025;
var scale = 250;
var crs = 'EPSG:4326';
var noData = -9999;
var china = ee.FeatureCollection('FAO/GAUL/2015/level0')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .geometry();
var source = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterBounds(china)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.eq('resolution_meters', 10))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));

function annualValidCount(year) {
  var start = ee.Date.fromYMD(year, 1, 1);
  return source
    .filterDate(start, start.advance(1, 'year'))
    .select('VV')
    .count()
    .rename('valid_count')
    .toInt16()
    .clip(china)
    .setDefaultProjection(crs, null, scale)
    .set({ year: year, 'system:time_start': start.millis() });
}
print('年份', ee.List.sequence(startYear, endYear));

for (var year = startYear; year <= endYear; year += 1) {
  var image = annualValidCount(year).unmask(noData, false);
  Export.image.toDrive({
    image: image,
    description: 'China_S1_valid_count_' + year + '_250m',
    fileNamePrefix: 'China_S1_IW_VVVH_valid_count_' + year + '_250m',
    folder: 'China_S1_annual_availability_250m',
    region: china,
    crs: crs,
    scale: scale,
    maxPixels: 1e10,
    fileDimensions: 8192,
    skipEmptyTiles: true,
    fileFormat: 'GeoTIFF',
    formatOptions: { cloudOptimized: true, noData: noData },
  });
}

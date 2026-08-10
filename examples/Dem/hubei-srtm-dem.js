// 湖北省 SRTM 30 m、250 m 与 1/120°（约 1 km）高程。
// 本地运行：node bin/ee examples/hubei-srtm-dem.js

var crs = 'EPSG:4326';
var noData = -32768;
var bounds = [108.4083333333333, 29.05, 116.125, 33.275];
var grid30m = [1 / 3600, 0, -180, 0, -1 / 3600, 90];
var grid1km = [1 / 120, 0, -180, 0, -1 / 120, 90];

var hubeiFeatures = ee.FeatureCollection('FAO/GAUL/2015/level1')
  .filter(ee.Filter.eq('ADM0_NAME', 'China'))
  .filter(ee.Filter.eq('ADM1_NAME', 'Hubei Sheng'));
var hubei = hubeiFeatures.geometry();
var dem30m = ee.Image('USGS/SRTMGL1_003')
  .select('elevation')
  .reproject({ crs: crs, crsTransform: grid30m })
  .clip(hubei)
  .rename('elevation');
var dem1km = dem30m
  .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 2048 })
  .reproject({ crs: crs, crsTransform: grid1km })
  .clip(hubei)
  .rename('elevation');

Map.centerObject(hubei, 7);
Map.addLayer(
  dem1km,
  { min: 0, max: 2000, palette: ['#E8E3CE', '#AFC38B', '#657C4B', '#46382B'] },
  'SRTM 1 km 高程',
);
Map.addLayer(
  ee.Image().byte().paint(hubeiFeatures, 1, 2),
  { palette: ['#202020'] },
  '湖北省界',
);

Export.image.toDrive({
  image: dem30m,
  description: 'Hubei_SRTM_30m_elevation',
  fileNamePrefix: 'Hubei_SRTMGL1_elevation_30m',
  region: hubei,
  crs: crs,
  crsTransform: grid30m,
  maxPixels: 1e9,
  fileFormat: 'GeoTIFF',
  formatOptions: { cloudOptimized: true, noData: noData },
});

/** 本地 gee-helper 下载；以上代码可直接复制到 Code Editor。 */
if (typeof module !== 'undefined') {
  var fs = require('node:fs');
  var pkg = require('../dist/index.js');
  var outdir = './data/hubei_dem';
  var file30m = outdir + '/Hubei_SRTMGL1_elevation_30m.tif';
  var file250m = outdir + '/Hubei_SRTMGL1_elevation_250m.tif';
  var file1km = outdir + '/Hubei_SRTMGL1_elevation_1over120deg.tif';

  function tiling(tileBounds, rows, cols, dimensions, dataType) {
    return {
      bounds: tileBounds,
      rows: rows,
      cols: cols,
      dimensions: dimensions,
      resampling: 'near',
      srcNoData: noData,
      dstNoData: noData,
      dataType: dataType,
    };
  }

  async function saveLocal() {
    await pkg.export_img_grids(dem1km.toFloat().unmask(noData, false), file1km, {
      outdir: outdir,
      region: hubei,
      crs: crs,
      tiling: tiling(bounds, 1, 1, [926, 507], 'Float32'),
    });
    await pkg.export_img_grids(dem30m.toInt16().unmask(noData, false), file30m, {
      outdir: outdir,
      region: hubei,
      crs: crs,
      retries: 5,
      tiling: tiling(bounds, 6, 8, [27780, 15210], 'Int16'),
    });
    if (!fs.existsSync(file250m)) {
      _host.gdalWarp([
        '-q', '-overwrite',
        '-t_srs', 'EPSG:32649',
        '-te', '247500', '3216250', '999500', '3693750',
        '-tr', '250', '250', '-tap',
        '-r', 'average',
        '-srcnodata', String(noData),
        '-dstnodata', String(noData),
        '-ot', 'Float32',
        '-co', 'TILED=YES', '-co', 'COMPRESS=DEFLATE', '-co', 'PREDICTOR=3',
        file30m,
        file250m,
      ]);
      console.log('完成：' + file250m);
    }
  }

  saveLocal();
}

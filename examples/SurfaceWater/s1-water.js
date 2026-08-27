/** Sentinel-1 IW 升轨 VV/VH → 90 m 水体。案例只提供区域、日期和坡度掩膜。 */

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

function threshold(image, region, mask) {
  var histogram = image.updateMask(image.mask().and(mask || ee.Image(1)))
    .reduceRegion({
      reducer: ee.Reducer.histogram(255, 0.1),
      geometry: region,
      scale: 30,
      maxPixels: 1e8,
      tileScale: 4,
    }).get('sar');
  return ee.Number(otsu(histogram));
}

function source(region, start, end) {
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterBounds(region)
    .filterDate(start, end)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.eq('orbitProperties_pass', 'ASCENDING'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'));
}

function buildWater(src, spec, opt) {
  var date = spec[0];
  var orbit = spec[1];
  var clip = opt.clip || opt.region;
  var images = src
    .filterDate(date, ee.Date(date).advance(1, 'day'))
    .filter(ee.Filter.eq('relativeOrbitNumber_start', orbit))
    .map(function (image) {
      return image.clipToBoundsAndScale({ geometry: clip, scale: 30 });
    });
  var projection = ee.Image(images.first()).select('VV').projection();
  var sar = sarScore(images.mosaic().setDefaultProjection(projection));
  var waterThreshold = threshold(sar, opt.region, opt.thresholdMask);
  var candidate = sar.lt(waterThreshold).and(opt.terrainMask);
  var connected = candidate.selfMask()
    .connectedPixelCount(100, true)
    .gte(8)
    .unmask(0);
  return candidate.and(connected)
    .updateMask(sar.mask())
    .clip(opt.region)
    .toFloat()
    .reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 256 })
    .gt(0.5)
    .rename('water')
    .toByte()
    .set({
      date: date,
      orbit: orbit,
      otsu_threshold_db: waterThreshold,
      'system:index': date.replace(/-/g, '') + '_R' + orbit,
      'system:time_start': ee.Date(date).millis(),
    });
}

function collection(src, acquisitions, opt) {
  return ee.ImageCollection.fromImages(
    acquisitions.map(function (spec) { return buildWater(src, spec, opt); }),
  );
}

function export90m(col, opt) {
  var pkg = require('gee-helper');
  var tiling = {
    bounds: opt.exportBounds,
    rows: 2,
    cols: 2,
    concurrency: 2,
    resampling: 'near',
    srcNoData: 255,
    dstNoData: 255,
    dataType: 'Byte',
  };
  var options = {
    outdir: opt.outdir,
    region: opt.region,
    crs: opt.crs,
    scale: 90,
    retries: 5,
    tiling: tiling,
  };
  return pkg.export_col(col, {
    prefix: opt.prefix,
    period: '1d',
    suffixPattern: /R(\d+)$/,
    maxGroups: Number(process.env.MAX_GROUPS || -1),
    concurrency: 1,
    exportImage: function (group) {
      var image = ee.Image(col.filter(
        ee.Filter.inList('system:index', group.indices),
      ).first()).unmask(255, false);
      return pkg.export_img(
        image,
        opt.outdir + '/' + group.name + '_water_90m.tif',
        options,
      );
    },
  });
}

module.exports = {
  sarScore: sarScore,
  threshold: threshold,
  source: source,
  collection: collection,
  export90m: export90m,
};

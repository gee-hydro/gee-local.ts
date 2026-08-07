function makeCrsTransform(bounds, cellsize) {
  return [
    cellsize, 0, bounds[0],
    0, -cellsize, bounds[3],
  ];
}

function resampleOptions(
  bounds,
  cellsize_target,
  cellsize_source = 1 / 3600,
) {
  var region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);
  return {
    crs: 'EPSG:4326',
    region: region,
    crsTransform_source: makeCrsTransform(bounds, cellsize_source),
    crsTransform_target: makeCrsTransform(bounds, cellsize_target),
  }
}

function resample(mosaic, options) {
  mosaic = mosaic.setDefaultProjection(
    ee.Projection(options.crs),
    options.crsTransform_source,
  ); // ! 必须指定，mosaic之后projection信息丢失

  return mosaic
    .reduceResolution({
      reducer: ee.Reducer.mean(),
      maxPixels: 1024,
    })
    .reproject({
      crs: 'EPSG:4326',
      crsTransform: options.crsTransform_target,
    });
}

module.exports = {
  resample,
  resampleOptions,
};

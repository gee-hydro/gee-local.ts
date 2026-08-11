import { ee } from '../ee';

export type ResampleOptions = {
  crs: string;
  region: ee.Geometry;
  crsTransform_source: number[];
  crsTransform_target: number[];
};

function makeCrsTransform(bounds: readonly number[], cellsize: number): number[] {
  return [
    cellsize, 0, bounds[0],
    0, -cellsize, bounds[3],
  ];
}

export function resampleOptions(
  bounds: readonly number[],
  cellsize_target: number,
  cellsize_source = 1 / 3600,
): ResampleOptions {
  const region = ee.Geometry.Rectangle(bounds, 'EPSG:4326', false);
  return {
    crs: 'EPSG:4326',
    region,
    crsTransform_source: makeCrsTransform(bounds, cellsize_source),
    crsTransform_target: makeCrsTransform(bounds, cellsize_target),
  };
}

export function resample(mosaic: ee.Image, options: ResampleOptions): ee.Image {
  mosaic = mosaic.setDefaultProjection(
    ee.Projection(options.crs),
    options.crsTransform_source,
  ); // ! 必须指定，mosaic之后projection信息丢失

  return mosaic.reduceResolution({
    reducer: ee.Reducer.mean(),
    maxPixels: 1024,
  });
}

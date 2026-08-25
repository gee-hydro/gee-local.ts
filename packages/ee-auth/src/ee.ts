/** 单一 Earth Engine 实例，避免多包副本导致鉴权状态分裂。 */
export const ee = require('@google/earthengine');

/** 与运行时 ee 同名的名义类型（@google/earthengine 无官方 d.ts） */
export namespace ee {
  /** EE Geometry / GeoJSON；length?: never 拒绝 bounds 四元组 */
  export type Geometry = object & { length?: never };
  /* eslint-disable @typescript-eslint/no-explicit-any */
  export type Array = any;
  export type Blob = any;
  export type Classifier = any;
  export type Clusterer = any;
  export type Collection = any;
  export type ComputedObject = any;
  export type ConfusionMatrix = any;
  export type Date = any;
  export type DateRange = any;
  export type Dictionary = any;
  export type Element = any;
  export type Feature = any;
  export type FeatureCollection = any;
  export type Filter = any;
  export type Image = any;
  export type ImageCollection = any;
  export type Join = any;
  export type Kernel = any;
  export type List = any;
  export type Model = any;
  export type Number = any;
  export type PixelType = any;
  export type Projection = any;
  export type Reducer = any;
  export type SelectorSet = any;
  export type String = any;
}

const runtime = globalThis as typeof globalThis & { ee?: typeof ee };
if (runtime.ee == null) runtime.ee = ee;

/** 单一 Earth Engine 实例，避免多包副本导致鉴权状态分裂。 */
export const ee = require('@google/earthengine');

/** 与运行时 ee 同名的名义类型（@google/earthengine 无官方 d.ts） */
export namespace ee {
  /** EE Geometry / GeoJSON；length?: never 拒绝 bounds 四元组 */
  export type Geometry = object & { length?: never };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type Image = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export type ImageCollection = any;
}

const runtime = globalThis as typeof globalThis & { ee?: typeof ee };
if (runtime.ee == null) runtime.ee = ee;

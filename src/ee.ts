/** 单一 Earth Engine 实例，避免多包副本导致鉴权状态分裂。 */
const eeNode = require('@google/earthengine');

export const ee = eeNode;

const runtime = globalThis as typeof globalThis & { ee?: typeof ee };
if (runtime.ee == null) runtime.ee = ee;

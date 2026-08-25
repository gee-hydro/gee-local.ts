/**
 * 导出用帧集合构造（daily_mean / native）。
 * 依赖宿主全局 ee；调用前须 ee.Initialize() 或已安装 globalThis.ee。
 */
import { ee } from '../ee';
import type { GeeDailyReduction, GeeTemporal } from '../types';

function toEeDateInput(timeIso: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(timeIso)) return timeIso;
  if (timeIso.charAt(timeIso.length - 1) === 'Z') return timeIso.replace(/\.\d{3}Z$/, 'Z');
  return timeIso;
}

function dailyFrameCollection(
  collection: string,
  band: string,
  start: string,
  end: string,
  reduction: GeeDailyReduction,
  stepHours: number,
) {
  const t0 = ee.Date(toEeDateInput(start).slice(0, 10));
  const t1 = ee.Date(toEeDateInput(end).slice(0, 10));
  const n = t1.difference(t0, 'day').add(1);
  const step = stepHours > 0 ? stepHours : 1;
  return ee.ImageCollection(ee.List.sequence(0, n.subtract(1)).map((d: unknown) => {
    const day = t0.advance(ee.Number(d), 'day');
    const dayStr = day.format('YYYY-MM-dd');
    const selected = ee.ImageCollection(collection).select(band)
      .filterDate(day, day.advance(1, 'day'));
    const reduced = reduction === 'sum'
      ? selected.sum().multiply(step)
      : selected.mean();
    return reduced
      .set('system:time_start', day.millis())
      .set('system:index', dayStr);
  }));
}

function nativeFrameCollection(
  collection: string,
  band: string,
  start: string,
  end: string,
  stepHours: number,
) {
  const t0 = ee.Date(toEeDateInput(start));
  const tEnd = ee.Date(toEeDateInput(end));
  const n = tEnd.difference(t0, 'hour').divide(stepHours).floor().add(1);
  return ee.ImageCollection(ee.List.sequence(0, n.subtract(1)).map((i: unknown) => {
    const time = t0.advance(ee.Number(i).multiply(stepHours), 'hour');
    const index = time.format("YYYYMMdd'T'HHmmss");
    return ee.ImageCollection(collection)
      .select(band)
      .filterDate(time, time.advance(stepHours, 'hour'))
      .mean()
      .set('system:time_start', time.millis())
      .set('system:index', index);
  }));
}

/** 返回闭区间 [start,end] 内的逐帧 ImageCollection。 */
export function frameCollection(
  collection: string,
  band: string,
  start: string,
  end: string,
  temporal: GeeTemporal,
  stepHours?: number,
  reduction?: GeeDailyReduction,
) {
  const step = stepHours == null ? 1 : stepHours;
  const dailyReduction = reduction == null ? 'mean' : reduction;
  return temporal === 'native'
    ? nativeFrameCollection(collection, band, start, end, step)
    : dailyFrameCollection(collection, band, start, end, dailyReduction, step);
}

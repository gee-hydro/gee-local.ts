import type { CacheBounds } from '../export/bounds';
import type { LocalFrame, LocalQuery } from './types';

const DAY_RE = /^(\d{4}-\d{2}-\d{2})/;

/** 取日期部分 YYYY-MM-DD */
export function toDay(iso: string): string {
  const m = DAY_RE.exec(iso.trim());
  if (!m) throw new Error(`非法日期: ${iso}`);
  return m[1]!;
}

/** 闭区间日期是否相交 [a0,a1] ∩ [b0,b1] */
export function dateOverlaps(a0: string, a1: string, b0: string, b1: string): boolean {
  const A0 = toDay(a0);
  const A1 = toDay(a1);
  const B0 = toDay(b0);
  const B1 = toDay(b1);
  if (A0 > A1 || B0 > B1) throw new Error('日期起止颠倒');
  return A0 <= B1 && B0 <= A1;
}

/** 矩形是否相交（边界相接算相交） */
export function boundsOverlaps(a: CacheBounds, b: CacheBounds): boolean {
  return a.west <= b.east && b.west <= a.east
    && a.south <= b.north && b.south <= a.north;
}

/** 按日期 / 范围 / collection / band / datasetId 筛选 */
export function filterFrames(
  frames: LocalFrame[],
  q: Omit<LocalQuery, 'root' | 'catalog'>,
): LocalFrame[] {
  const start = q.start != null ? toDay(q.start) : undefined;
  const end = q.end != null ? toDay(q.end) : undefined;
  if ((start != null) !== (end != null)) {
    throw new Error('start/end 须成对提供');
  }
  if (start && end && start > end) throw new Error('start > end');

  return frames.filter((f) => {
    if (q.datasetId && f.datasetId !== q.datasetId && f.id !== q.datasetId) return false;
    if (start && end && !dateOverlaps(f.start, f.end, start, end)) return false;
    if (q.bounds && !boundsOverlaps(f.bounds, q.bounds)) return false;
    if (q.collection && f.collection !== q.collection) return false;
    if (q.band && f.band !== q.band) return false;
    return true;
  });
}

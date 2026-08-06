import * as fs from 'node:fs';

export type Period = {
  count: number;
  unit: 'd' | 'm' | 'y';
};

export type Group = {
  key: string;
  name: string;
  indices: string[];
};

export type LogOptions = {
  log?: false | ((message: string) => void);
};

type Evaluatable<T> = {
  evaluate(callback: (value: T, error?: unknown) => void): void;
};

export function mkpath(dirname: string): void {
  fs.mkdirSync(dirname, { recursive: true });
}

export function evaluate<T = unknown>(object: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    (object as Evaluatable<T>).evaluate((value, error) => {
      if (error) reject(new Error(String(error)));
      else resolve(value);
    });
  });
}

export function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

export function log(options: LogOptions, message: string): void {
  if (options.log === false) return;
  (options.log || console.log)(message);
}

export function pad2(value: number | string): string {
  return String(value).padStart(2, '0');
}

export function parsePeriod(period?: string): Period {
  const match = /^(\d+)([dmy])$/i.exec(String(period || '1d'));
  const count = match ? Number(match[1]) : 0;
  if (!match || !Number.isInteger(count) || count < 1) {
    throw new Error('period 须为 Nd、Nm 或 Ny，例如 8d、1m、1y');
  }
  return { count, unit: match[2].toLowerCase() as Period['unit'] };
}

export function groupKey(timestamp: number | string, period: Period): string {
  const date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) {
    throw new Error('无效的 system:time_start：' + timestamp);
  }

  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const suffix = period.count === 1 ? '' : '_' + period.count + period.unit;

  if (period.unit === 'd') {
    const day_ms = 24 * 60 * 60 * 1000;
    const year_start = Date.UTC(year, 0, 1);
    const day = Date.UTC(year, month, date.getUTCDate());
    const offset = Math.floor((day - year_start) / day_ms / period.count)
      * period.count;
    const start = new Date(year_start + offset * day_ms);
    return String(start.getUTCFullYear()) +
      pad2(start.getUTCMonth() + 1) +
      pad2(start.getUTCDate()) + suffix;
  }

  if (period.unit === 'm') {
    const absolute_month = year * 12 + month;
    const start_month = Math.floor(absolute_month / period.count) * period.count;
    return String(Math.floor(start_month / 12)) +
      pad2(start_month % 12 + 1) + suffix;
  }
  return String(Math.floor(year / period.count) * period.count) + suffix;
}

export function split_group(
  indices: string[],
  timestamps: Array<number | string>,
  period: Period,
  prefix?: string,
  suffix_pattern?: RegExp,
): Group[] {
  if (indices.length !== timestamps.length) {
    throw new Error('system:index 与 system:time_start 数量不一致');
  }

  const groups: Record<string, string[]> = {};
  const keys: string[] = [];
  indices.forEach((index, i) => {
    let key = groupKey(timestamps[i], period);
    const match = suffix_pattern && String(index).match(suffix_pattern);
    if (match) {
      const suffix = String(match[1] == null ? match[0] : match[1])
        .replace(/[^A-Za-z0-9._-]+/g, '_');
      key += '_' + suffix;
    }
    if (!groups[key]) {
      groups[key] = [];
      keys.push(key);
    }
    groups[key].push(index);
  });
  return keys.map((key) => ({
    key,
    name: String(prefix || '') + key,
    indices: groups[key],
  }));
}

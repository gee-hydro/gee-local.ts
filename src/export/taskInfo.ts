import * as fs from 'node:fs';
import * as path from 'node:path';
import { ee } from '../ee';
import { csvCell, evaluate } from './utilize.js';

type ImageCollection = {
  reduceColumns(
    reducer: unknown,
    properties: string[],
  ): {
    get(property: string): unknown;
  };
};

type Logger = null | ((message: string) => void);

export async function exportTaskInfo(
  images: unknown,
  filename: string,
  properties: string[],
  log: Logger = null,
): Promise<void> {
  if (!filename) throw new Error('sceneRecord.filename 不能为空');
  if (!Array.isArray(properties) || properties.length < 1) {
    throw new Error('sceneRecord.properties 须为非空数组');
  }

  const rows = (images as ImageCollection).reduceColumns(
    ee.Reducer.toList(properties.length),
    properties,
  ).get('list');
  const values = await evaluate<unknown[][]>(rows);
  const timeIndex = properties.indexOf('system:time_start');
  const header = properties.slice();
  if (timeIndex >= 0) header[timeIndex] = 'datetime_utc';

  const lines = [header.map(csvCell).join(',')];
  values.forEach((row) => {
    const cells = row.slice();
    if (timeIndex >= 0 && cells[timeIndex] != null) {
      cells[timeIndex] = new Date(Number(cells[timeIndex])).toISOString();
    }
    lines.push(cells.map(csvCell).join(','));
  });

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, lines.join('\n') + '\n');
  if (log) log('影像记录：' + filename);
}

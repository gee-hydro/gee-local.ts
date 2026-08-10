import * as fs from 'node:fs';
import * as path from 'node:path';

type CsvRecords<T extends object> = readonly T[] | ReadonlyMap<unknown, T>;

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

export function read_csv(filename: string): Record<string, string>[] {
  if (!fs.existsSync(filename)) return [];
  const text = fs.readFileSync(filename, 'utf8').trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const header = parseCsvLine(lines.shift()!);
  return lines.map((line) => {
    const cells = parseCsvLine(line);
    return header.reduce<Record<string, string>>((record, name, i) => {
      record[name] = cells[i] == null ? '' : cells[i];
      return record;
    }, {});
  });
}

function csv_text<T extends object>(
  records: CsvRecords<T>,
  columns: readonly string[] | undefined,
  include_header: boolean,
): string {
  const rows = Array.from(records.values());
  const header = columns || Object.keys(rows[0] || {});
  const lines = rows.map((record) => header.map((name) => {
    const value = Reflect.get(record, name);
    const text = value == null ? '' : String(value);
    return /[",\n\r]/.test(text)
      ? '"' + text.replace(/"/g, '""') + '"'
      : text;
  }).join(','));
  if (include_header) lines.unshift(header.join(','));
  return lines.join('\n') + '\n';
}

export function write_csv<T extends object>(
  filename: string,
  records: CsvRecords<T>,
  columns?: readonly string[],
): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + '.tmp';
  fs.writeFileSync(tmp, csv_text(records, columns, true));
  fs.renameSync(tmp, filename);
}

export function append_csv<T extends object>(
  filename: string,
  records: CsvRecords<T>,
  columns?: readonly string[],
): void {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const exists = fs.existsSync(filename) && fs.statSync(filename).size > 0;
  fs.appendFileSync(filename, csv_text(records, columns, !exists));
}

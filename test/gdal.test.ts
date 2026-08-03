import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'node:test';
import { saveConfig } from '../src/local/config';
import { gdalWarp } from '../src/local/gdal';

test('gdalWarp 从 config 注入 PROJ 环境', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-gdal-'));
  const output = path.join(cwd, 'env.json');
  const projData = path.join(cwd, 'proj');

  try {
    saveConfig({
      gdal: {
        command: process.execPath,
        projData,
        gtiffSrsSource: 'EPSG',
      },
    }, 'project', cwd);

    const script = [
      "require('node:fs').writeFileSync(process.argv[1], JSON.stringify({",
      '  cwd: process.cwd(),',
      '  projData: process.env.PROJ_DATA,',
      '  projLib: process.env.PROJ_LIB,',
      '  gtiffSrsSource: process.env.GTIFF_SRS_SOURCE,',
      '}));',
    ].join('\n');
    gdalWarp(['-e', script, output], cwd);

    assert.deepEqual(JSON.parse(fs.readFileSync(output, 'utf8')), {
      cwd,
      projData,
      projLib: projData,
      gtiffSrsSource: 'EPSG',
    });
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

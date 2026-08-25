import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { test } from 'node:test';
import { stripVTControlCharacters } from 'node:util';

const skip = !existsSync(`${homedir()}/.config/earthengine/credentials`);
const src = `
const ee = require('ee-auth');
ee.Initialize(process.argv[1]);
print(ee.Number(1).add(41));
`;

test('gee-hydro / gee-kongdd 均可计算 1+41', { skip }, () => {
  for (const p of ['gee-hydro', 'gee-kongdd']) {
    const r = spawnSync(process.execPath, ['-e', src, p], {
      encoding: 'utf8',
      timeout: 120_000
    });
    if (r.status) throw new Error(r.stderr || `${p} failed`);
    assert.equal(stripVTControlCharacters(r.stdout).trim().split('\n').at(-1), '42', p);
  }
});

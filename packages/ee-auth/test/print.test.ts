import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ee } from '../src/ee';
import '../src/print';

test('print 支持单个及多个 GEE 对象', async () => {
  const initialize = ee.Initialize;
  const log = console.log;
  const output: unknown[][] = [];
  const image = { type: 'Image' };
  const x = { getInfo: () => 42 };
  const img = { getInfo: () => image };
  let ready!: () => void;
  const initialized = new Promise<void>((resolve) => { ready = resolve; });
  ee.Initialize = () => initialized;
  console.log = (...values) => { output.push(values); };
  try {
    const printed = [print(x), print(img), print(x, img)];
    assert.deepEqual(output, []);
    ready();
    await Promise.all(printed);
  } finally {
    ee.Initialize = initialize;
    console.log = log;
  }
  assert.deepEqual(output, [[42], [image], [42, image]]);
});

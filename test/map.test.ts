import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { renderMap, type MapCapture } from '../src/local/map';

function image(url: string) {
  return {
    getMap(
      _vis: Record<string, unknown>,
      callback: (mapId: { urlFormat: string }) => void,
    ) {
      callback({ urlFormat: url });
    },
  };
}

test('renderMap 生成 MapLibre GEE 瓦片地图', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gee-map-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const output = path.join(dir, 'map.html');
  const map: MapCapture = {
    output,
    region: {
      type: 'Polygon',
      coordinates: [[[110, 30], [112, 30], [112, 32], [110, 32], [110, 30]]],
    },
    basemap: 'SATELLITE',
    layers: [
      {
        image: image('https://earthengine.test/{z}/{x}/{y}'),
        vis: { min: 0, max: 1 },
        name: 'Water </script>',
        shown: false,
        opacity: 0.4,
      },
    ],
  };

  assert.equal(await renderMap(map, 'water.js'), output);
  const html = fs.readFileSync(output, 'utf8');
  assert.match(html, /maplibre-gl@6\.2\.0\/dist\/maplibre-gl\.mjs/);
  assert.match(html, /earthengine\.test\/\{z\}\/\{x\}\/\{y\}/);
  assert.match(html, /"bounds":\[110,30,112,32\]/);
  assert.match(html, /"shown":false/);
  assert.match(html, /"opacity":0\.4/);
  assert.match(html, /World_Imagery/);
  assert.doesNotMatch(html, /Water <\/script>/);
});

test('renderMap 无图层时不输出文件', async () => {
  assert.equal(await renderMap({ layers: [] }, 'empty.js'), undefined);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getDownloadUrl,
  type DownloadUrlImage,
} from '../src/local/download';

test('getDownloadUrl 将回调封装为 Promise', async () => {
  const params = { name: 'test' };
  const image: DownloadUrlImage = {
    getDownloadURL(received, callback) {
      assert.equal(received, params);
      callback('https://example.test/image.tif');
    },
  };

  assert.equal(
    await getDownloadUrl(image, params),
    'https://example.test/image.tif',
  );
});

test('getDownloadUrl 转发 Earth Engine 错误', async () => {
  const image: DownloadUrlImage = {
    getDownloadURL(_params, callback) {
      callback(undefined, 'download failed');
    },
  };

  await assert.rejects(
    getDownloadUrl(image, {}),
    /download failed/,
  );
});

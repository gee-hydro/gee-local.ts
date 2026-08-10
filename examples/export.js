/**
 * 库 API：本地下载 1 天 SMAP GeoTIFF（小区域）。
 *
 *   ee examples/export.js
 *   DRY_RUN=1 ee examples/export.js
 */
const pkg = require('../dist');
const { exportBatches } = pkg;

const dryRun = process.env.DRY_RUN === '1';
const outdir = './cache/examples/smap';

// 区域不宜过小：scale=9000 时像素过少会导致 GeoTIFF <1KB 被拒绝
const opts = {
  collection: 'NASA/SMAP/SPL4SMGP/008',
  band: 'sm_surface',
  scale: 9000,
  bounds: { west: 108.5, south: 29.0, east: 116.2, north: 33.3 }, // 湖北
  start: '2024-07-01',
  end: '2024-07-01',
  temporal: 'daily_mean',
  bucket: 'day',
  cacheDir: outdir,
  concurrency: 1,
  onBatch: (info) => {
    console.log(
      `[${info.status}] ${info.bucketStart}~${info.bucketEnd}`
      + ` frames=${info.framesCount} → ${info.file} (${info.bytes} B)`
      + (info.error ? `  ${info.error}` : ''),
    );
  },
};

(async () => {
  console.log('# SMAP local export');
  console.log(`  region  : Hubei box`);
  console.log(`  range   : ${opts.start} ~ ${opts.end}`);
  console.log(`  outdir  : ${outdir}`);
  console.log(`  dry-run : ${dryRun}`);
  if (dryRun) {
    console.log('# skip download (DRY_RUN=1)');
    return;
  }
  const results = await exportBatches(opts);
  const ok = results.filter((r) => r.status === 'ok').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  console.log(`# done ok=${ok} fail=${fail}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});

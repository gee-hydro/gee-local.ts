const { ee, getInfo } = require('..');

async function main() {
  const t0 = Date.now();
  await ee.Initialize();
  console.log(`ee.Initialize ${Date.now() - t0} ms`);
  const n = await getInfo(ee.Number(1).add(41));
  console.log(n);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

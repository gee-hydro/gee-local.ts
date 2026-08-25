const { ee } = require('..');

async function main() {
  const t0 = Date.now();
  await ee.Initialize();
  console.log(`ee.Initialize ${Date.now() - t0} ms`);
  console.log(ee.Number(1).add(41).getInfo());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

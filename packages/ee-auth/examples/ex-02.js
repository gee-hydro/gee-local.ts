const ee = require('ee-auth');

async function main() {
  await ee.Initialize();
  console.log('1 + 41 =', ee.Number(1).add(41).getInfo());
}
main()

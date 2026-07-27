#!/usr/bin/env node
/**
 * CLI 入口：ee <command>
 * 按命令懒加载，避免 help/config 拉起 earthengine。
 */
import { HELP, parseArgs, type Cli } from './args';

type Handler = (cli: Cli) => number | Promise<number>;

/** CommonJS 懒加载（不触发 earthengine，直到真正用到） */
function load(cmd: Cli['cmd']): Handler {
  switch (cmd) {
    case 'submit': return require('./export').cmdSubmit;
    case 'status': return require('./export').cmdStatus;
    case 'list': return require('./export').cmdList;
    case 'jobs': return require('./export').cmdJobs;
    case 'cancel': return require('./export').cmdCancel;
    case 'run': return require('./run').cmdRun;
    case 'add': return require('./pkg').cmdAdd;
    case 'config': return require('./pkg').cmdConfig;
    case 'data': return require('./data').cmdData;
    default: throw new Error(`unknown cmd: ${cmd}`);
  }
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<number> {
  let cli: Cli;
  try {
    cli = parseArgs(argv);
  } catch (e) {
    console.error(`参数错误: ${e instanceof Error ? e.message : e}`);
    console.log(HELP);
    return 2;
  }

  if (cli.cmd === 'help') {
    console.log(HELP);
    return 0;
  }

  try {
    return await load(cli.cmd)(cli);
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('unknown cmd')) {
      console.log(HELP);
      return 2;
    }
    throw e;
  }
}

if (require.main === module) {
  void run()
    .then((code) => process.exit(code))
    .catch((e) => { console.error(e); process.exit(1); });
}

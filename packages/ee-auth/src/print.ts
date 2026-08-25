import { ee } from './ee';

declare global {
  function print(...values: unknown[]): Promise<void>;
}

const runtime = globalThis as typeof globalThis & {
  print?: (...values: unknown[]) => Promise<void>;
};

if (runtime.print == null) {
  runtime.print = async (...values) => {
    await ee.Initialize();
    console.log(...values.map((value) => {
      const computed = value as { getInfo?: () => unknown };
      return typeof computed?.getInfo === 'function' ? computed.getInfo() : value;
    }));
  };
}

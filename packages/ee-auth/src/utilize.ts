import { ee } from './ee';
import './auth';

type Evaluatable<T> = {
  evaluate(callback: (result: T, error?: unknown) => void): void;
};

function isEvaluatable<T>(object: unknown): object is Evaluatable<T> {
  return object != null
    && typeof (object as { evaluate?: unknown }).evaluate === 'function';
}

/** 将 ee.ComputedObject 异步求值（Promise 版 getInfo）。 */
export async function getInfo<T = unknown>(object: unknown): Promise<T> {
  await ee.Initialize();
  if (!isEvaluatable<T>(object)) {
    throw new Error('getInfo: 需要 ee.ComputedObject（含 .evaluate）');
  }
  return new Promise<T>((resolve, reject) => {
    object.evaluate((result, error) => {
      if (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }
      resolve(result);
    });
  });
}

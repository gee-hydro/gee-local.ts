/**
 * 本地算子注册表。P0 仅 crop；干旱/洪涝指标后续 registerLocalOp。
 */
import type { LocalOp, LocalOpName } from './types';

const registry = new Map<LocalOpName, LocalOp>();

export function registerLocalOp(name: LocalOpName, op: LocalOp): void {
  if (!name.trim()) throw new Error('op name 为空');
  registry.set(name, op);
}

export function getLocalOp(name: LocalOpName): LocalOp | undefined {
  return registry.get(name);
}

export function listLocalOps(): string[] {
  return [...registry.keys()].sort();
}

export function runLocalOp(name: LocalOpName, ...args: Parameters<LocalOp>): ReturnType<LocalOp> {
  const op = registry.get(name);
  if (!op) throw new Error(`未知本地算子: ${name}（已注册: ${listLocalOps().join(', ') || '无'}）`);
  return op(...args);
}

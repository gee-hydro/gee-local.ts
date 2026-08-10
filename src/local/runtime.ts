export type RuntimeHost = {
  getDownloadUrl(
    image: unknown,
    params: Record<string, unknown>,
  ): Promise<string>;
  gdalWarp?(args: readonly string[]): void;
};

export type Runtime = typeof globalThis & {
  _host?: RuntimeHost;
  print?: (...values: unknown[]) => void;
};

export function runtime(): Runtime {
  return globalThis as Runtime;
}

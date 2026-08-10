export type RuntimeHost = {
  getDownloadUrl(image: unknown, params: unknown): Promise<string>;
};

export type Runtime = typeof globalThis & {
  _host?: RuntimeHost;
  print?: (...values: unknown[]) => void;
};

export function runtime(): Runtime {
  return globalThis as Runtime;
}

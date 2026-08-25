import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';

const compilerOptions = {
  esModuleInterop: true,
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
};
const offlineHome = '/offline-home';
const credentialsPath = `${offlineHome}/.config/earthengine/credentials`;
const privateKeyPath = `${offlineHome}/.config/earthengine/.private-key.json`;
const cacheDir = `${offlineHome}/.cache/gee-helper`;
const tokenCachePath = `${cacheDir}/access-token.json`;
const algorithmsCachePath = `${cacheDir}/algorithms.json`;

type EeInitModule = {
  Initialize(): Promise<void>;
  getInfo<T = unknown>(obj: unknown): Promise<T>;
};

type FakeFs = {
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: string): string;
  mkdirSync?(path: string, options: { recursive: boolean; mode: number }): void;
  writeFileSync?(path: string, data: string, options: { mode: number }): void;
  renameSync?(from: string, to: string): void;
  unlinkSync?(path: string): void;
};

type LoadOptions = {
  fs: FakeFs;
  ee: object;
  OAuth2Client: new (clientId: string, clientSecret: string) => object;
  privateKey?: object;
  eeVersion?: string;
};

function loadCjs(
  file: string,
  fakeRequire: (id: string) => unknown,
): Record<string, unknown> {
  const modulePath = resolve(__dirname, file);
  const source = ts.transpileModule(
    readFileSync(modulePath, 'utf8'),
    { compilerOptions, fileName: modulePath },
  ).outputText;
  const module = { exports: {} as Record<string, unknown> };
  const context = vm.createContext({
    console: { log: () => undefined },
    Error,
    process: { env: { HOME: offlineHome }, pid: 123, platform: 'linux' },
  });
  const wrapper = vm.runInContext(
    `(function (exports, require, module, __filename, __dirname) {${source}\n})`,
    context,
    { filename: modulePath },
  ) as (
    exports: Record<string, unknown>,
    require: (id: string) => unknown,
    module: { exports: Record<string, unknown> },
    filename: string,
    moduleDirname: string,
  ) => void;
  wrapper(module.exports, fakeRequire, module, modulePath, dirname(modulePath));
  return module.exports;
}

function loadAuth(options: LoadOptions): EeInitModule {
  loadCjs('../src/auth.ts', (id) => {
    if (id === 'node:crypto') return { createHash };
    if (id === 'node:fs') return options.fs;
    if (id === './ee') return { ee: options.ee };
    if (id === 'google-auth-library') return { OAuth2Client: options.OAuth2Client };
    if (id === '@google/earthengine/package.json') {
      return { version: options.eeVersion ?? '1.7.37' };
    }
    if (id === privateKeyPath && options.privateKey) return options.privateKey;
    throw new Error(`unexpected require: ${id}`);
  });
  const ee = options.ee as { Initialize: () => Promise<void> };
  return { Initialize: () => ee.Initialize() } as EeInitModule;
}

function loadUtilize(): Pick<EeInitModule, 'getInfo'> {
  const ee = { Initialize: async () => undefined };
  return loadCjs('../src/utilize.ts', (id) => {
    if (id === './ee') return { ee };
    if (id === './auth') return {};
    throw new Error(`unexpected require: ${id}`);
  }) as Pick<EeInitModule, 'getInfo'>;
}

class UnusedOAuth2Client {
  constructor() {
    throw new Error('OAuth2Client should not be constructed');
  }
}

test('service-account 凭证优先，并完成私钥认证与 initialize', async () => {
  const privateKey = {
    client_email: 'viewer@hydro-project.iam.gserviceaccount.com',
    private_key: 'offline-private-key',
  };
  let authenticatedKey: object | undefined;
  let initializedProject: string | undefined;
  let credentialsRead = false;
  const ee = {
    data: {
      authenticateViaPrivateKey(
        key: object,
        success: () => void,
        _failure: (error: unknown) => void,
      ) {
        authenticatedKey = key;
        queueMicrotask(success);
      },
    },
    initialize(
      _baseUrl: unknown,
      _tileUrl: unknown,
      success: () => void,
      _failure: (error: unknown) => void,
      _xsrfToken: unknown,
      project: string,
    ) {
      initializedProject = project;
      queueMicrotask(success);
    },
  };
  const auth = loadAuth({
    fs: {
      existsSync: (path) => path === privateKeyPath || path === credentialsPath,
      readFileSync: () => {
        credentialsRead = true;
        throw new Error('OAuth credentials must not be read');
      },
    },
    ee,
    OAuth2Client: UnusedOAuth2Client,
    privateKey,
  });

  await auth.Initialize();

  assert.equal(authenticatedKey, privateKey);
  assert.equal(initializedProject, 'hydro-project');
  assert.equal(credentialsRead, false);
});

test('OAuth credentials 安装 token refresher、设置 auth token 并完成 initialize', async () => {
  const credentials = {
    client_id: 'offline-client-id',
    client_secret: 'offline-client-secret',
    refresh_token: 'offline-refresh-token',
    project: 'offline-project',
  };
  const oauthInstances: FakeOAuth2Client[] = [];
  let refresher:
    | ((authArgs: unknown, callback: (token: Record<string, unknown>) => void) => void)
    | undefined;
  let setAuthTokenArgs: unknown[] | undefined;
  let initializedProject: string | undefined;

  class FakeOAuth2Client {
    readonly clientId: string;
    readonly clientSecret: string;
    credentials: object | undefined;
    accessTokenCalls = 0;

    constructor(clientId: string, clientSecret: string) {
      this.clientId = clientId;
      this.clientSecret = clientSecret;
      oauthInstances.push(this);
    }

    setCredentials(value: object) {
      this.credentials = value;
    }

    async getAccessToken() {
      this.accessTokenCalls += 1;
      return {
        token: this.accessTokenCalls === 1 ? 'initial-access-token' : 'refreshed-access-token',
        res: { data: { expires_in: 1800 } },
      };
    }
  }

  const ee = {
    data: {
      setAuthTokenRefresher(value: typeof refresher) {
        refresher = value;
      },
    },
    apiclient: {
      setAuthToken(...args: unknown[]) {
        setAuthTokenArgs = args;
      },
    },
    initialize(
      _baseUrl: unknown,
      _tileUrl: unknown,
      success: () => void,
      _failure: (error: unknown) => void,
      _xsrfToken: unknown,
      project: string,
    ) {
      initializedProject = project;
      queueMicrotask(success);
    },
  };
  const files = new Map([[credentialsPath, JSON.stringify(credentials)]]);
  let cacheDirMode: number | undefined;
  let cacheFileMode: number | undefined;
  const fs: FakeFs = {
    existsSync: (path) => files.has(path),
    readFileSync: (path, encoding) => {
      assert.equal(encoding, 'utf8');
      const value = files.get(path);
      if (value == null) throw new Error(`missing file: ${path}`);
      return value;
    },
    mkdirSync: (path, options) => {
      assert.equal(path, cacheDir);
      cacheDirMode = options.mode;
    },
    writeFileSync: (path, data, options) => {
      files.set(path, data);
      cacheFileMode = options.mode;
    },
    renameSync: (from, to) => {
      const value = files.get(from);
      if (value == null) throw new Error(`missing file: ${from}`);
      files.set(to, value);
      files.delete(from);
    },
    unlinkSync: (path) => {
      files.delete(path);
    },
  };
  const auth = loadAuth({ fs, ee, OAuth2Client: FakeOAuth2Client });

  await auth.Initialize();

  assert.equal(oauthInstances.length, 1);
  const client = oauthInstances[0];
  assert.equal(client.clientId, credentials.client_id);
  assert.equal(client.clientSecret, credentials.client_secret);
  assert.equal(
    (client.credentials as { refresh_token?: string }).refresh_token,
    credentials.refresh_token,
  );
  assert.equal(setAuthTokenArgs?.[0], credentials.client_id);
  assert.equal(setAuthTokenArgs?.[1], 'Bearer');
  assert.equal(setAuthTokenArgs?.[2], 'initial-access-token');
  assert.equal(setAuthTokenArgs?.[3], 1800);
  assert.equal(Array.isArray(setAuthTokenArgs?.[4]), true);
  assert.equal((setAuthTokenArgs?.[4] as unknown[]).length, 0);
  assert.equal(setAuthTokenArgs?.[5], undefined);
  assert.equal(setAuthTokenArgs?.[6], false);
  assert.equal(initializedProject, credentials.project);
  assert.equal(typeof refresher, 'function');
  assert.equal(cacheDirMode, 0o700);
  assert.equal(cacheFileMode, 0o600);
  const initialCache = JSON.parse(files.get(tokenCachePath) ?? '{}');
  assert.equal(initialCache.access_token, 'initial-access-token');
  assert.equal(initialCache.credential_id.length, 64);

  const refreshedToken = await new Promise<Record<string, unknown>>((resolveToken) => {
    refresher?.({}, resolveToken);
  });
  assert.equal(refreshedToken.access_token, 'refreshed-access-token');
  assert.equal(refreshedToken.token_type, 'Bearer');
  assert.equal(refreshedToken.expires_in, 1800);
  assert.equal(client.accessTokenCalls, 2);
  const refreshedCache = JSON.parse(files.get(tokenCachePath) ?? '{}');
  assert.equal(refreshedCache.access_token, 'refreshed-access-token');

  setAuthTokenArgs = undefined;
  const cachedAuth = loadAuth({ fs, ee, OAuth2Client: FakeOAuth2Client });
  await cachedAuth.Initialize();

  assert.equal(oauthInstances.length, 2);
  assert.equal(oauthInstances[1].accessTokenCalls, 0);
  assert.equal(setAuthTokenArgs?.[2], 'refreshed-access-token');
  assert.ok(Number(setAuthTokenArgs?.[3]) > 1700);
});

test('算法注册表按 Earth Engine JS 版本缓存', async () => {
  const privateKey = { client_email: 'viewer@cache-project.iam.gserviceaccount.com' };
  const algorithms = { 'Image.add': { args: [], description: 'add', returns: 'Image' } };
  const files = new Map<string, string>();
  let requests = 0;
  const fs: FakeFs = {
    existsSync: (path) => path === privateKeyPath || files.has(path),
    readFileSync: (path) => {
      const value = files.get(path);
      if (value == null) throw new Error(`missing file: ${path}`);
      return value;
    },
    mkdirSync: () => undefined,
    writeFileSync: (path, data) => files.set(path, data),
    renameSync: (from, to) => {
      const value = files.get(from);
      if (value == null) throw new Error(`missing file: ${from}`);
      files.set(to, value);
      files.delete(from);
    },
    unlinkSync: (path) => { files.delete(path); },
  };
  const ee = {
    data: {
      authenticateViaPrivateKey(
        _key: object,
        success: () => void,
      ) {
        queueMicrotask(success);
      },
      getAlgorithms(callback: (value: object) => void) {
        requests += 1;
        callback(algorithms);
      },
    },
    initialize(
      _baseUrl: unknown,
      _tileUrl: unknown,
      success: () => void,
    ) {
      this.data.getAlgorithms(success);
    },
  };

  await loadAuth({
    fs,
    ee,
    OAuth2Client: UnusedOAuth2Client,
    privateKey,
    eeVersion: '1.0.0',
  }).Initialize();
  await loadAuth({
    fs,
    ee,
    OAuth2Client: UnusedOAuth2Client,
    privateKey,
    eeVersion: '1.0.0',
  }).Initialize();

  assert.equal(requests, 1);
  assert.equal(JSON.parse(files.get(algorithmsCachePath) ?? '{}').ee_version, '1.0.0');

  await loadAuth({
    fs,
    ee,
    OAuth2Client: UnusedOAuth2Client,
    privateKey,
    eeVersion: '2.0.0',
  }).Initialize();

  assert.equal(requests, 2);
  assert.equal(JSON.parse(files.get(algorithmsCachePath) ?? '{}').ee_version, '2.0.0');
});

test('initialize 失败后清空 readyPromise，下一次 Initialize 会重试', async () => {
  const privateKey = { client_email: 'viewer@retry-project.iam.gserviceaccount.com' };
  let authenticationAttempts = 0;
  let initializeAttempts = 0;
  const ee = {
    data: {
      authenticateViaPrivateKey(
        _key: object,
        success: () => void,
        _failure: (error: unknown) => void,
      ) {
        authenticationAttempts += 1;
        queueMicrotask(success);
      },
    },
    initialize(
      _baseUrl: unknown,
      _tileUrl: unknown,
      success: () => void,
      failure: (error: unknown) => void,
    ) {
      initializeAttempts += 1;
      if (initializeAttempts === 1) {
        queueMicrotask(() => failure('temporary failure'));
      } else {
        queueMicrotask(success);
      }
    },
  };
  const auth = loadAuth({
    fs: {
      existsSync: (path) => path === privateKeyPath,
      readFileSync: () => {
        throw new Error('credentials should not be read');
      },
    },
    ee,
    OAuth2Client: UnusedOAuth2Client,
    privateKey,
  });

  await assert.rejects(auth.Initialize(), /ee\.initialize: temporary failure/);
  await auth.Initialize();

  assert.equal(authenticationAttempts, 2);
  assert.equal(initializeAttempts, 2);
});

test('getInfo 求值成功、拒绝无 evaluate 对象并传播 evaluate 错误', async () => {
  const util = loadUtilize();

  const result = await util.getInfo<{ value: number }>({
    evaluate: (callback: (value: object) => void) => callback({ value: 42 }),
  });
  assert.deepEqual(result, { value: 42 });

  await assert.rejects(util.getInfo({}), /需要 ee\.ComputedObject/);

  const evaluateError = new Error('offline evaluate failed');
  await assert.rejects(
    util.getInfo({
      evaluate: (callback: (value: unknown, error: Error) => void) => {
        callback(undefined, evaluateError);
      },
    }),
    (error) => {
      assert.equal(error, evaluateError);
      return true;
    },
  );
});

test('无凭证时 Initialize 失败', async () => {
  const auth = loadAuth({
    fs: {
      existsSync: () => false,
      readFileSync: () => {
        throw new Error('no files');
      },
    },
    ee: {},
    OAuth2Client: UnusedOAuth2Client,
  });

  await assert.rejects(
    auth.Initialize(),
    /无 GEE 凭证/,
  );
});

test('OAuth 缺 client 时回退 earthengine CLI 默认值', async () => {
  const credentials = { refresh_token: 'offline-refresh-token', project: 'p' };
  let clientId = '';
  let clientSecret = '';
  class FakeOAuth2Client {
    constructor(id: string, secret: string) {
      clientId = id;
      clientSecret = secret;
    }
    setCredentials() {}
    async getAccessToken() {
      return { token: 'tok', res: { data: { expires_in: 1800 } } };
    }
  }
  const ee = {
    data: { setAuthTokenRefresher() {} },
    apiclient: { setAuthToken() {} },
    initialize(
      _b: unknown,
      _t: unknown,
      success: () => void,
    ) {
      queueMicrotask(success);
    },
  };
  const files = new Map([[credentialsPath, JSON.stringify(credentials)]]);
  await loadAuth({
    fs: {
      existsSync: (path) => files.has(path),
      readFileSync: (path) => files.get(path) ?? '',
      mkdirSync: () => undefined,
      writeFileSync: (path, data) => { files.set(path, data); },
      renameSync: (from, to) => {
        files.set(to, files.get(from) ?? '');
        files.delete(from);
      },
      unlinkSync: (path) => { files.delete(path); },
    },
    ee,
    OAuth2Client: FakeOAuth2Client,
  }).Initialize();

  assert.equal(
    clientId,
    '517222506229-vsmmajv00ul0bs7p89v5m89qs8eb9359.apps.googleusercontent.com',
  );
  assert.equal(clientSecret, 'RUP0RZ6e0pPhDzsqIJ7KlNd1');
});

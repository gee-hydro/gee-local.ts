/**
 * GEE Node-only 鉴权初始化。
 * 优先 service-account（~/.config/earthengine/.private-key.json）
 * 否则 OAuth refresh-token（~/.config/earthengine/credentials）
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import { OAuth2Client } from 'google-auth-library';
import { ee } from './ee';

const { version: EE_VERSION } = require('@google/earthengine/package.json') as {
  version: string;
};

const HOME = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
const CREDENTIALS = `${HOME}/.config/earthengine/credentials`;
const PRIVATE_KEY = `${HOME}/.config/earthengine/.private-key.json`;
const CACHE_DIR = `${process.env.XDG_CACHE_HOME || `${HOME}/.cache`}/gee-helper`;
const TOKEN_CACHE = `${CACHE_DIR}/access-token.json`;
const ALGORITHMS_CACHE = `${CACHE_DIR}/algorithms.json`;
const EXPIRY_SKEW_MS = 60_000;
/** earthengine CLI 默认 OAuth client（与 python `earthengine-api` 一致） */
// https://github.com/google/earthengine-api/blob/master/python/ee/oauth.py
const EE_CLIENT_ID = '517222506229-vsmmajv00ul0bs7p89v5m89qs8eb9359.apps.googleusercontent.com';
const EE_CLIENT_SECRET = 'RUP0RZ6e0pPhDzsqIJ7KlNd1';

type OAuthCredentials = {
  client_id?: string;
  client_secret?: string;
  refresh_token?: string;
  project?: string;
};

type PrivateKey = Record<string, unknown> & {
  client_email?: string;
};

type AccessToken = {
  token: string;
  expiresIn: number;
};

type Algorithms = Record<string, unknown>;

let readyPromise: Promise<void> | null = null;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = (error as { message?: unknown } | null)?.message;
  return String(message || error);
}

function credentialId(
  credentials: OAuthCredentials,
  clientId: string,
): string {
  return createHash('sha256')
    .update(`${clientId}\0${credentials.project || ''}\0${credentials.refresh_token || ''}`)
    .digest('hex');
}

function readTokenCache(id: string): AccessToken | null {
  try {
    if (!fs.existsSync(TOKEN_CACHE)) return null;
    const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8')) as {
      credential_id?: unknown;
      access_token?: unknown;
      expires_at?: unknown;
    };
    const expiresIn = Math.floor((Number(cache.expires_at) - Date.now()) / 1000);
    if (cache.credential_id !== id || typeof cache.access_token !== 'string'
        || expiresIn * 1000 <= EXPIRY_SKEW_MS) {
      return null;
    }
    return { token: cache.access_token, expiresIn };
  } catch {
    return null;
  }
}

function writeCache(file: string, value: unknown): void {
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch {
    try {
      fs.unlinkSync(temporary);
    } catch {
      // 缓存失败不影响鉴权。
    }
  }
}

function writeTokenCache(id: string, token: string, expiresIn: number): void {
  writeCache(TOKEN_CACHE, {
    credential_id: id,
    access_token: token,
    expires_at: Date.now() + expiresIn * 1000,
  });
}

function readAlgorithmsCache(): Algorithms | null {
  try {
    const cache = JSON.parse(fs.readFileSync(ALGORITHMS_CACHE, 'utf8')) as {
      ee_version?: unknown;
      algorithms?: unknown;
    };
    return cache.ee_version === EE_VERSION && cache.algorithms
      && typeof cache.algorithms === 'object'
      ? cache.algorithms as Algorithms
      : null;
  } catch {
    return null;
  }
}

function initializeEe(
  project: string | undefined,
  success: () => void,
  failure: (error: unknown) => void,
  useCache = true,
): void {
  const original = ee.data.getAlgorithms;
  if (typeof original !== 'function') {
    ee.initialize(null, null, success, failure, null, project);
    return;
  }

  const cached = useCache ? readAlgorithmsCache() : null;
  const restore = (): void => {
    ee.data.getAlgorithms = original;
  };
  ee.data.getAlgorithms = (
    callback: (algorithms?: Algorithms, error?: unknown) => void,
  ) => {
    if (cached) return callback(cached);
    return original.call(ee.data, (algorithms: Algorithms, error?: unknown) => {
      if (algorithms && !error) {
        writeCache(ALGORITHMS_CACHE, { ee_version: EE_VERSION, algorithms, });
      }
      callback(algorithms, error);
    });
  };

  const fail = (error: unknown): void => {
    restore();
    if (!cached) {
      failure(error);
      return;
    }
    try {
      fs.unlinkSync(ALGORITHMS_CACHE);
    } catch {
      // 忽略失效缓存清理错误。
    }
    if (typeof ee.reset === 'function') ee.reset();
    void Promise.resolve().then(() => {
      initializeEe(project, success, failure, false);
    });
  };

  try {
    ee.initialize(null, null,
      () => {
        restore();
        success();
      },
      fail, null, project,
    );
  } catch (error) {
    fail(error);
  }
}

function tokenLifetime(response: unknown): number {
  const expiresIn = Number(
    (response as { data?: { expires_in?: unknown } } | null)?.data?.expires_in,
  );
  return Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
}

async function refreshToken(
  client: OAuth2Client,
  id: string,
): Promise<AccessToken> {
  const { token, res } = await client.getAccessToken();
  if (!token) throw new Error('empty access_token');
  const expiresIn = tokenLifetime(res);
  writeTokenCache(id, token, expiresIn);
  return { token, expiresIn };
}

function initEe(project?: string): Promise<void> {
  return new Promise((resolve, reject) => {
    initializeEe(
      project,
      resolve,
      (error) => reject(new Error(`ee.initialize: ${error}`)),
    );
  });
}

async function connectPrivateKey(): Promise<void> {
  const key = require(PRIVATE_KEY) as PrivateKey;
  await new Promise<void>((resolve, reject) => {
    ee.data.authenticateViaPrivateKey(
      key,
      resolve,
      (error: unknown) => reject(new Error(`private-key auth: ${error}`)),
    );
  });
  await initEe(key.client_email?.split('@')[1]?.split('.')[0]);
  console.log('[gee] ready (service-account)');
}

async function connectOAuth(): Promise<void> {
  const credentials = JSON.parse(
    fs.readFileSync(CREDENTIALS, 'utf8'),
  ) as OAuthCredentials;
  const clientId = credentials.client_id || EE_CLIENT_ID;
  const client = new OAuth2Client(
    clientId,
    credentials.client_secret || EE_CLIENT_SECRET,
  );
  client.setCredentials({ refresh_token: credentials.refresh_token });
  const id = credentialId(credentials, clientId);

  // Node 无 GIS 弹窗；须自带 refresher，否则 access_token 约 1h 后失效。
  ee.data.setAuthTokenRefresher((
    _authArgs: unknown,
    callback: (response: Record<string, unknown>) => void,
  ) => {
    refreshToken(client, id)
      .then(({ token, expiresIn }) => callback({
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
      }))
      .catch((error: unknown) => callback({
        error: 'refresh_token: ' + errorMessage(error),
      }));
  });

  try {
    const { token, expiresIn } = readTokenCache(id) ?? await refreshToken(client, id);
    ee.apiclient.setAuthToken(
      clientId, 'Bearer', token, expiresIn, [], undefined, false,
    );
  } catch (error) {
    throw new Error('refresh_token: ' + errorMessage(error));
  }
  await initEe(credentials.project);
  console.log('[gee] ready (OAuth)');
}

async function connect(): Promise<void> {
  if (fs.existsSync(PRIVATE_KEY)) return connectPrivateKey();
  if (fs.existsSync(CREDENTIALS)) return connectOAuth();
  throw new Error(`无 GEE 凭证：${CREDENTIALS} 或 ${PRIVATE_KEY}`);
}

/** 对齐 Python `ee.Initialize()`。失败可重试。 */
function Initialize(): Promise<void> {
  if (!readyPromise) {
    readyPromise = connect().catch((error) => {
      readyPromise = null;
      throw error instanceof Error ? error : new Error(String(error));
    });
  }
  return readyPromise;
}

ee.Initialize = Initialize;

'use strict';

/**
 * GEE Node-only 鉴权初始化 + 异步求值封装。
 * 优先 service-account（~/.config/earthengine/.private-key.json）
 * 否则 OAuth refresh-token（~/.config/earthengine/credentials）
 */
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const { ee } = require('./ee');
const { OAuth2Client } = require('google-auth-library');

const HOME = process.env[process.platform === 'win32' ? 'USERPROFILE' : 'HOME'];
const CREDENTIALS = `${HOME}/.config/earthengine/credentials`;
const PRIVATE_KEY = `${HOME}/.config/earthengine/.private-key.json`;
const CACHE_DIR = `${process.env.XDG_CACHE_HOME || `${HOME}/.cache`}/gee-helper`;
const TOKEN_CACHE = `${CACHE_DIR}/access-token.json`;
const EXPIRY_SKEW_MS = 60_000;
/** earthengine CLI 默认 OAuth client（与 `earthengine authenticate` 一致） */
const EE_CLIENT_ID = '517222506229-vsmmajv00ul0bs7p89v5m89qs8eb9359.apps.googleusercontent.com';
const EE_CLIENT_SECRET = 'RUP0RZ6e0pPhDzsqIJ7KlNd1';

let readyPromise = null;

function credentialId(credentials, clientId) {
  return createHash('sha256')
    .update(`${clientId}\0${credentials.project || ''}\0${credentials.refresh_token || ''}`)
    .digest('hex');
}

function readTokenCache(id) {
  try {
    if (!fs.existsSync(TOKEN_CACHE)) return null;
    const cache = JSON.parse(fs.readFileSync(TOKEN_CACHE, 'utf8'));
    const expiresIn = Math.floor((Number(cache.expires_at) - Date.now()) / 1000);
    if (cache.credential_id !== id || typeof cache.access_token !== 'string' ||
        expiresIn * 1000 <= EXPIRY_SKEW_MS) return null;
    return { token: cache.access_token, expiresIn };
  } catch {
    return null;
  }
}

function writeTokenCache(id, token, expiresIn) {
  const tmp = `${TOKEN_CACHE}.${process.pid}.tmp`;
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, `${JSON.stringify({
      credential_id: id,
      access_token: token,
      expires_at: Date.now() + expiresIn * 1000,
    })}\n`, { mode: 0o600 });
    fs.renameSync(tmp, TOKEN_CACHE);
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* 缓存失败不影响鉴权 */ }
  }
}

function tokenLifetime(response) {
  const expiresIn = Number(response?.data?.expires_in);
  return Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 3600;
}

async function refreshToken(client, id) {
  const { token, res } = await client.getAccessToken();
  if (!token) throw new Error('empty access_token');
  const expiresIn = tokenLifetime(res);
  writeTokenCache(id, token, expiresIn);
  return { token, expiresIn };
}

/**
 * 初始化 GEE。失败清空内存缓存，允许下次请求重试。
 * OAuth access token 跨进程缓存至 $XDG_CACHE_HOME/gee-helper。
 * @returns {Promise<void>}
 */
function ensureReady() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    const fail = (e) => {
      readyPromise = null;
      reject(e instanceof Error ? e : new Error(String(e)));
    };

    if (fs.existsSync(PRIVATE_KEY)) {
      const key = require(PRIVATE_KEY);
      ee.data.authenticateViaPrivateKey(
        key,
        () => ee.initialize(null, null,
          () => { console.log('[gee] ready (service-account)'); resolve(); },
          (e) => fail(new Error(`ee.initialize: ${e}`)),
          null, key.client_email?.split('@')[1]?.split('.')[0]),
        (e) => fail(new Error(`private-key auth: ${e}`)),
      );
      return;
    }

    if (!fs.existsSync(CREDENTIALS)) {
      fail(new Error(`无 GEE 凭证：${CREDENTIALS} 或 ${PRIVATE_KEY}`));
      return;
    }

    const o2 = JSON.parse(fs.readFileSync(CREDENTIALS, 'utf8'));
    const clientId = o2.client_id || EE_CLIENT_ID;
    const client = new OAuth2Client(
      clientId,
      o2.client_secret || EE_CLIENT_SECRET,
    );
    client.setCredentials({ refresh_token: o2.refresh_token });
    const id = credentialId(o2, clientId);

    // Node 无 GIS 弹窗；须自带 refresher，否则 access_token ~1h 过期后 getMap 报 missing credential
    ee.data.setAuthTokenRefresher((_authArgs, callback) => {
      refreshToken(client, id)
        .then(({ token, expiresIn }) => callback({
          access_token: token,
          token_type: 'Bearer',
          expires_in: expiresIn,
        }))
        .catch((e) => callback({ error: `refresh_token: ${e.message || e}` }));
    });

    const cached = readTokenCache(id);
    (cached ? Promise.resolve(cached) : refreshToken(client, id))
      .then(({ token, expiresIn }) => {
        ee.apiclient.setAuthToken(
          clientId,
          'Bearer',
          token,
          expiresIn,
          [],
          undefined,
          false,
        );
        ee.initialize(null, null,
          () => { console.log('[gee] ready (OAuth)'); resolve(); },
          (e) => fail(new Error(`ee.initialize: ${e}`)),
          null, o2.project);
      })
      .catch((e) => fail(new Error(`refresh_token: ${e.message || e}`)));
  });
  return readyPromise;
}

/**
 * 将 ee.ComputedObject 异步求值（Promise 版 getInfo）。
 * @template T
 * @param {{ evaluate: Function }} obj
 * @returns {Promise<T>}
 */
async function getInfo(obj) {
  await ensureReady();
  return new Promise((resolve, reject) => {
    if (obj == null || typeof obj.evaluate !== 'function') {
      reject(new Error('getInfo: 需要 ee.ComputedObject（含 .evaluate）'));
      return;
    }
    obj.evaluate((result, err) => {
      if (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      resolve(result);
    });
  });
}

exports.ensureReady = ensureReady;
exports.getInfo = getInfo;

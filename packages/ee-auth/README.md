# ee-auth

GEE Node 快速鉴权。优先 `~/.config/earthengine/.private-key.json`，否则 OAuth（`earthengine authenticate`）。

```js
const { ee, ensureReady, getInfo } = require('ee-auth');

await ensureReady();
const n = await getInfo(ee.ImageCollection('NASA/SMAP/SPL4SMGP/008').size());
```

本仓库：`npm install ee-auth`（workspace）。其他项目：

```bash
npm install /path/to/gee-helper.ts/packages/ee-auth
```

## 为何快

`ee.initialize()` 默认每次都拉完整算法注册表，OAuth 还要刷新 access token，冷启动主要耗在这两次网络。

结果缓存在 `${XDG_CACHE_HOME:-~/.cache}/gee-helper/`（`600`）：

| 文件 | 跳过的网络 | 失效条件 |
| --- | --- | --- |
| `access-token.json` | `refresh_token` → access token | 过期前 60s，或凭证变更 |
| `algorithms.json` | `getAlgorithms` 注册表 | `@google/earthengine` 版本变，或 initialize 失败（删缓存重试） |

二次启动只读本地文件。

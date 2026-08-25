# ee-auth

3 行完成 GEE OAuth 授权。首次使用前运行 `earthengine authenticate`。

```js
const ee = require('ee-auth');
ee.Initialize();                 // 或 ee.Initialize('gee-kongdd') / $EE_PROJECT
print(ee.ImageCollection('NASA/SMAP/SPL4SMGP/008'));
```

`print()` 会等待初始化完成，无需 `await`。

```bash
node examples/hello.js   # 或 npm start / npm run hello
```

本仓库：`npm install ee-auth`（workspace）。其他项目：

```bash
npm install /path/to/gee-helper.ts/packages/ee-auth
```

## 为何快

`ee.initialize()` 默认每次都拉完整算法注册表，OAuth 还要刷新 access token，冷启动主要耗在这两次网络。

结果缓存在 `${XDG_CACHE_HOME:-~/.cache}/gee-helper/`（`600`）：

| 文件 | 跳过的网络 | 节省 | 失效条件 |
| --- | --- | ---: | --- |
| `access-token.json` | `refresh_token` → access token | 0.46 s | 过期前 60s、凭证变更，或初始化 401（refresh 后重试） |
| `algorithms.json` | `getAlgorithms` 注册表 | 0.84 s | `@google/earthengine` 版本变，或 initialize 失败（删缓存重试） |

本机实测（OAuth，`ee.Initialize` 墙钟，3 次中位数）：双缓存 20 ms，无缓存 1.2 s。节省 = 缺该文件、另一份仍在时的增量。

# ee-auth

`ee-auth` 是面向 Node.js 的 CommonJS 包，复用 Earth Engine CLI 的 OAuth 凭证，并导出已扩展 `Initialize()` 的唯一 `ee` 实例。

## 使用

首次运行前完成授权：

```bash
earthengine authenticate
```

安装：

```bash
# gee-helper workspace 内
npm install ee-auth

# 其他项目
npm install /path/to/gee-helper.ts/packages/ee-auth
```

初始化后即可使用标准 GEE JavaScript API：

```js
const ee = require('ee-auth');

ee.Initialize();
print(ee.Number(1).add(41));
```

项目 ID 按以下优先级确定：

1. `ee.Initialize('project-id')`
2. 环境变量 `EE_PROJECT`
3. `~/.config/earthengine/credentials` 中的 `project`

同一进程只需调用一次 `ee.Initialize()`；并发调用共享同一初始化任务。全局 `print()` 会等待初始化完成后求值 GEE 对象。

OAuth access token 与 GEE 算法注册表缓存在 `${XDG_CACHE_HOME:-~/.cache}/gee-helper/`。缓存 token 导致初始化 401 时会 refresh 后重试一次。

## 开发

```bash
npm run build
npm run typecheck
npm test
npm run hello
```

- 公共入口仅为 `src/index.ts` 导出的 `ee`。
- 始终复用 `src/ee.ts` 的实例，禁止再次加载独立 Earth Engine 实例。
- 保持 CommonJS、严格 TypeScript、单引号、分号和 2 空格缩进。
- 修改鉴权、项目选择或缓存逻辑时，同步更新测试与 `README.md`。

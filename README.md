# gee-helper

[![CI](https://github.com/gee-hydro/gee-helper.ts/actions/workflows/CI.yml/badge.svg)](https://github.com/gee-hydro/gee-helper.ts/actions/workflows/CI.yml)
[![Codecov](https://codecov.io/gh/gee-hydro/gee-helper.ts/branch/main/graph/badge.svg)](https://app.codecov.io/gh/gee-hydro/gee-helper.ts/tree/main)

GEE 鉴权、批量导出、Code Editor 风格 JS 本地运行与 GEE 脚本包管理。
CLI 入口：`bin/ee`（`ee`）。

## 安装
```bash
npm install && npm run build
```

**Auth**
- `~/.config/earthengine/.private-key.json`
- `earthengine authenticate`（OAuth）
- OAuth access token 缓存于 `${XDG_CACHE_HOME:-~/.cache}/gee-helper/access-token.json`（权限 `600`）

## CLI

```bash
ee help
```

### 导出

```bash
# 本地 GeoTIFF
ee submit --destination local \
  --collection NASA/SMAP/SPL4SMGP/008 --band sm_surface --scale 9000 \
  --temporal daily_mean --bounds 108.5,29.0,116.2,33.3 \
  --start 2024-07-01 --end 2024-07-02 --outdir ./cache/gee-batches

# Drive / GCS
ee submit --destination drive --folder gee-exports \
  --collection ... --band ... --scale 9000 --temporal daily_mean \
  --bounds ... --start ... --end ...
ee status --job job_<id>
ee cancel --job job_<id>
ee list --limit 20
ee jobs
```

必填：`--collection --band --scale --temporal --bounds --start --end`  
可选：`--bucket auto|day|week|month|range`、`--reduction`、`--step-hours`、`--dry-run` 等。

时间区间为**闭区间**；`temporal=native` 时须正 `--step-hours`。

### 本地运行

```bash
ee script.js [more.js ...]       # 多脚本只鉴权一次
ee --repl
ee --package-path ./packages script.js
```

注入 `ee` / `print` / `Map` / `Export` / `Chart` / `ui.Chart`，以及 Code Editor 风格 `require`（路径须带 `.js`）。

网页端与本地可共用同一入口：

```js
var pkg = require('users/kongdd/pkg:pkg.js');
```

`pkg_main`、`pkg_extract`、`pkg_export`、`pkg_index`、`pkg_CMRSET` 可直接共用；`src/` 为旧 Node 宿主，`untest/` 依赖已迁移仓库，不纳入兼容层。

### 包管理

```bash
ee add user/pkg                  # → packages/users/user/pkg
ee config show
ee config set packages ./packages
```

包路径优先级：`--package-path` > `$GEE_JS_PATH` > config > `./packages`  
`require('users/x/y:mod.js')` → `packages/users/x/y/mod.js`

## 库 API

```ts
import {
  ensureReady, getInfo, ee,
  exportBatches, submitExportTasks,
  runScript, setupLocalHost,
  addPackage, loadMergedConfig,
} from 'gee-helper';
```

子路径：`gee-helper/auth`、`gee-helper/export`。

## 示例

见 [`examples/`](examples/README.md)。

```bash
ee examples/hello.js
ee examples/with-require.js examples/require-smap.js
node examples/export.js          # 库 API 本地下载
./examples/RunALL.sh             # DRY_RUN=1 可只 dry-run
```

## 测试

```bash
npm test
npm run test:coverage   # text + coverage/lcov.info
```

## 目录

```bash
src/
  ee.js auth.js       唯一 EE 实例；鉴权
  export/             批量导出（local / Drive / GCS）
  local/              本地宿主、require、config、add
  cli/                CLI（按命令懒加载，help 不拉 EE）
  index.ts            公共 API
packages/             GEE JS 包根
examples/ test/
```

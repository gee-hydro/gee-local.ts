# gee-helper

[![CI](https://github.com/gee-hydro/gee-helper.ts/actions/workflows/CI.yml/badge.svg)](https://github.com/gee-hydro/gee-helper.ts/actions/workflows/CI.yml)
[![Codecov](https://codecov.io/gh/gee-hydro/gee-helper.ts/branch/main/graph/badge.svg)](https://app.codecov.io/gh/gee-hydro/gee-helper.ts/tree/main)

GEE 鉴权、批量导出、Code Editor 风格 JS 本地运行与 GEE 脚本包管理。
CLI 入口：`bin/ee`（`ee`）。

## 安装
```bash
npm install && npm run build
```

**Auth**（独立包 [`packages/ee-auth`](packages/ee-auth)，其他项目可 `npm install <path>/packages/ee-auth`）

```js
const ee = require('ee-auth');
ee.Initialize();
print(ee.ImageCollection('NASA/SMAP/SPL4SMGP/008'));
```

`print()` 会等待初始化完成，无需 `await`。

- 首次使用前运行 `earthengine authenticate`
- OAuth access token 缓存于 `${XDG_CACHE_HOME:-~/.cache}/gee-helper/access-token.json`（权限 `600`），未过期则跳过刷新
- 算法注册表缓存于同目录；命中则 `ee.initialize()` 不再拉取 `getAlgorithms`（版本变化或失效时更新）
- 本机实测 `ee.Initialize`：双缓存 20 ms；`access-token.json` 省 0.46 s，`algorithms.json` 省 0.84 s

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

本地注入对象、地图预览、单景下载、切片合并和逐景分组导出见 [本地运行与导出](docs/local-runtime.md)。

GDAL 环境写入用户级 `~/.config/gee-helper/config.json`，由宿主注入子进程：

```json
{
  "gdal": {
    "projData": "/usr/share/proj",
    "gtiffSrsSource": "EPSG"
  }
}
```

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

### 本地数据（注册 tif/nc + 筛选 + Julia apply）

| 格式    | 后端                          | 形态                      |
| ------- | ----------------------------- | ------------------------- |
| GeoTIFF | SpatialRasterLite（ArchGDAL） | 单景 2D / 目录多时相      |
| NetCDF  | NCDatasets → `SpatRaster`     | 三维时空 `(lon,lat,time)` |

```bash
# 首次：julia --project=julia -e 'using Pkg; Pkg.instantiate()'

# 注册
ee data register --id smap_tif --path ./cache/examples/smap
ee data register --id sm_nc --path ./data/sm.nc --band sm --format nc
ee data ls
ee data unregister --id sm_nc

# 筛选（--catalog 默认 catalog/local.json；--root 仍可扫 export sidecar）
ee data query --start 2024-07-01 --end 2024-07-31 --bounds 110,30,115,32
ee data crop --id smap_tif --bounds 110,30,115,32 --outdir ./cache/local-crop

# 用户函数统一签名（2D/3D 同一入口）
# apply(ra::SpatRaster; params...)  # ra.A :: (nx,ny)|(nx,ny,nt)
ee data apply --id sm_nc --fn julia/ops/mean_time.jl \
  --start 2024-07-01 --end 2024-07-10 --outdir ./cache/local-apply
```

库 API：`registerLocal` / `queryLocal` / `cropLocal` / `applyLocal`。

## 库 API

```ts
import {
  ee, evaluate,
  exportBatches, submitExportTasks,
  runScript, setupLocalHost,
  addPackage, loadMergedConfig,
  queryLocal, cropLocal, applyLocal, registerLocalOp,
  SurfaceWater_HLS,
} from 'gee-helper';
```

OPERA DSWx-HLS 水体比例：

```js
const col = ee.ImageCollection('OPERA/DSWX/L3_V1/HLS')
  .filterBounds(region)
  .filterDate('2023-01-01', '2027-01-01');
const options = {
  bounds: [110.67, 32.42, 111.73, 33.07],
  outdir: './data/surface-water',
};
const groups = await SurfaceWater_HLS.frac_valid(col, options);
await SurfaceWater_HLS.download(col, { ...options, groups });
```

`frac_valid` 写出 `all.csv`、`selected.csv`；`download` 下载全部或指定 `groups`。处理 Landsat、Sentinel 等数据时，传入自定义 `buildWater(images)`（输出带掩膜的 0/1 水体影像）及 `sourceCellsize` 即可复用同一流程。

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
  ee.js auth.js       再导出 ee-auth
  export/             批量导出（local / Drive / GCS）
  data/               本地 catalog / 筛选 / Julia worker
  local/              本地宿主、require、config、add
  cli/                CLI（按命令懒加载，help 不拉 EE）
  index.ts            公共 API
julia/                SpatialRasterLite worker
packages/             GEE JS 包根；ee-auth 独立 npm 包
examples/ test/
```

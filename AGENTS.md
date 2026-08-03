# AGENTS.md

## 项目定位

`gee-helper` 是独立 CommonJS 包，提供：

- GEE service-account / OAuth 鉴权
- 本地 GeoTIFF、Google Drive、GCS 批量导出
- Code Editor 风格 GEE JavaScript 本地运行（`ee script.js`）
- GEE JS 包管理（`packages/` + `ee add`）
- 统一 CLI：`bin/ee`

## 常用命令

```bash
npm install
npm run build
npm run typecheck
npm test
npm run test:coverage

node bin/ee help
node bin/ee script.js [more.js ...]       # 多脚本只鉴权一次
node bin/ee add user/pkg                  # clone → packages/users/user/pkg
node bin/ee config set packages ./packages
node bin/ee submit --dry-run \
  --collection NASA/SMAP/SPL4SMGP/008 \
  --band sm_surface --scale 9000 --temporal daily_mean \
  --bounds 108.5,29.0,116.2,33.3 \
  --start 2024-07-01 --end 2024-07-02
```

示例：`./examples/RunALL.sh`（或 `DRY_RUN=1`）。

## 代码组织

```
src/
  ee.js / auth.js     唯一 EE 实例；鉴权 + getInfo
  export/             batches / tasks / frame-collection / bounds
  data/               本地 catalog / 日期范围筛选 / Julia worker
  local/              local-host / gee-require / pkg-add / config
  cli/
    index.ts          入口；按命令 require 懒加载（help 不拉 EE）
    args.ts           参数解析 + HELP
    export.ts         submit / status / list / jobs / cancel
    data.ts           data ls|query|crop|ops（不拉 EE）
    run.ts            run / repl
    pkg.ts            config / add（轻量）
  cli.ts              re-export → dist/cli.js（bin/ee 入口）
  index.ts            公共 API
julia/                SpatialRasterLite JSON-Lines worker
packages/             GEE JS 包根（require 须带 .js）
examples/             可运行示例
test/                 离线单测
```

## 修改原则

- TypeScript 严格类型；单引号、分号、2 空格、尾随逗号
- 保持 CommonJS；CLI 构建后须可由 `node bin/ee` 直接运行
- 禁止另行导入或初始化 Earth Engine；统一 `src/ee.js`
- `auth.js` 不记录 token、refresh token 或私钥内容
- 凭证优先级：private key → Earth Engine OAuth credentials
- 导出时间区间为闭区间；native 模式必须显式提供正 `stepHours`
- `local-host` 修改后须验证内置 `Map` 构造器兼容性及全局清理
- CLI 入口保持懒加载：`help` / `config` / `add` / `data` 不得静态依赖 EE
- 本地数据注册：`ee data register` → `catalog/local.json`；格式 `tif`（SpatialRasterLite/ArchGDAL）与 `nc`（NCDatasets 三维时空）
- 本地处理：`julia/gee_local_worker.jl`；用户函数 `apply(ra::SpatRaster; params...)`，`ra.A` 为 2D/3D
- 自定义指标写 `.jl` 后 `ee data apply --fn ...`
- GEE 包 `require` 须带 `.js`（Code Editor 语法）；`users/x/y:mod.js` → `packages/users/x/y/mod.js`
- 同一脚本兼容 GEE Code Editor 与本地 GEE 时，两部分代码必须分开：标准 GEE JavaScript 置于文件最上方，本地专用代码集中置于其后，避免交错，确保主体代码可直接复制到 GEE Code Editor
- 函数不得隐式读取业务全局变量；区域、时间、阈值、网格、集合和输出路径等依赖须通过参数显式传入
- 本地下载地址统一由 `_host.getDownloadUrl(image, params)` 获取，脚本不得重复封装 `Image.getDownloadURL`
- 本地逐景下载统一复用 `packages/users/kongdd/pkg/export.js`；通用函数不得硬编码数据源逻辑，影像命名、筛选、构建及分组函数须由调用方注入；并发数由 `concurrency` 控制，默认 4
- packages 路径优先级：`--package-path` > `$GEE_JS_PATH` > config > `./packages`
- 不把 server 数据源注册表引入本包；CLI 使用 collection/band/scale/temporal
- 数据本地导出优先使用 `/mnt/z/GitHub/gee-hydro/gee-export`，其效率更高
- 修改公共 API、CLI 参数或 job manifest 时同步更新 README 与测试
- 不提交 `package-lock.json`（CI 用 `npm install`）

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
  ee.ts / auth.ts     唯一 EE 实例；鉴权 + getInfo
  export/             export-col.ts / export-image.ts / export-tile.ts / utilize.ts / batches / tasks
  data/               本地 catalog / 日期范围筛选 / Julia worker
  local/              local-host / runtime / gee-require / pkg-add / config
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

## 极简代码设计

详细原则见 [`MINIMAL_CODE_DESIGN.md`](MINIMAL_CODE_DESIGN.md)。

- 主流程保持单向、线性；每一步输入输出明确。
- 一个函数只做一件事；机制与业务规则分离。
- 优先直接复用已有能力；拒绝重复实现、无效包装和过度抽象。
- 通过划分职责简化代码，不以删除必要功能换取简短。
- 先定义数据流，再划分函数；每个函数只完成一个动作。
- 领域逻辑与通用机制分离；用户决定处理方式，库只负责可靠执行。
- 参数只传给真正需要它的函数，避免万能 `options` 和隐式全局依赖。
- 副作用集中在边界层，核心流程保持线性、显式、可测试。

## 修改原则

- TypeScript 严格类型；使用单引号、分号和 2 空格缩进，不使用尾随逗号
- 保持 CommonJS 与 CLI 懒加载；`src` 内使用无扩展名导入，统一复用 `src/ee.ts`
- GEE 包路径须带 `.js`；兼容脚本中，标准 GEE 代码在前，本地专用代码在后
- 修改 `examples` 前先检索 `src/index.ts` 和相邻示例；通用机制统一复用 `pkg` API
- 导出时间区间为闭区间，native 模式须提供正 `stepHours`；本地运行与导出遵循 [`docs/local-runtime.md`](docs/local-runtime.md)，相关改动同步更新文档与测试

# examples

需 GEE 凭证：`~/.config/earthengine/credentials` 或 `.private-key.json`。

```bash
./examples/RunALL.sh          # 全量（含本地下载）
DRY_RUN=1 ./examples/RunALL.sh  # export 仅计划
```

## Code Editor 风格（`ee script.js`）

```bash
# 单脚本
node bin/ee examples/hello.js
node bin/ee examples/smap-mean.js
node bin/ee examples/modis-ndvi.js
node bin/ee examples/qinhuangdao-latest-lst.js

# require：内置 / 相对路径 / packages 包
node bin/ee examples/with-require.js
node bin/ee examples/require-pkg.js
node bin/ee examples/require-smap.js

# 多脚本：只鉴权一次
node bin/ee \
  examples/hello.js \
  examples/with-require.js \
  examples/require-pkg.js \
  examples/require-smap.js \
  examples/smap-mean.js \
  examples/modis-ndvi.js
```

`run` 注入 `require` / `module` / `__filename` / `__dirname`。

**GEE JS 包**（默认 `./packages`；路径**须带 `.js`**）：

```js
require('region.js')
require('hydro/mask.js')
require('users/kongdd/utils:math.js')  // → packages/users/kongdd/utils/math.js
```

```bash
ee add user/pkg                  # git clone googlesource → packages/users/...
ee config set packages ./packages
ee config get packages
```

| 文件 | 说明 |
|------|------|
| `hello.js` | 最小 print / ee |
| `with-require.js` | Node 内置 + `require('region.js')` |
| `require-pkg.js` | 裸名 / 嵌套 / users:mod |
| `require-smap.js` | 包 + 真实 SMAP 查询 |
| `smap-mean.js` / `modis-ndvi.js` | 纯 Code Editor 风格 |
| `qinhuangdao-latest-lst.js` | Landsat 7/8/9 联合检索最新地表温度 |
| `qinhuangdao-lst-availability.js` | 检索 2026 年 1—9 月可用 LST，输出逐景及月平均 CSV |

### 秦皇岛地表温度验证记录

2026-08-06 本地实测通过：Landsat 7/8/9 联合检索到 293 景候选影像；最新有效影像为 Landsat 9（2026-07-29，产品 `LC09_L2SP_121032_20260729_20260730_02_T1`），秦皇岛市有效像元比例为 0.5485。交互式地图和温度直方图均成功创建。

本地运行同时输出：

- 数据：`data/qinhuangdao_lst/Qinhuangdao_Landsat_LST_<date>_90m.tif`
- 地图：`maps/qinhuangdao_latest_lst.html`（MapLibre 交互式图层）

## 库 API 本地下载

```bash
DRY_RUN=1 node examples/export.js   # 只打印计划
node examples/export.js             # 下载 1 天 SMAP GeoTIFF
```

## CLI 导出

```bash
# dry-run（湖北范围；过小区域在 scale=9000 时 GeoTIFF 可能 <1KB 被拒）
node bin/ee submit --dry-run --destination local \
  --collection NASA/SMAP/SPL4SMGP/008 --band sm_surface --scale 9000 \
  --temporal daily_mean --bounds 108.5,29.0,116.2,33.3 \
  --start 2024-07-01 --end 2024-07-01 \
  --outdir ./cache/examples/smap

# 真下载 + 自定义 buildFrame
node bin/ee submit --destination local \
  --collection NASA/SMAP/SPL4SMGP/008 --band sm_surface --scale 9000 \
  --temporal daily_mean --bounds 108.5,29.0,116.2,33.3 \
  --start 2024-07-01 --end 2024-07-01 \
  --outdir ./cache/examples/smap-custom \
  --user-script examples/build-frame.js
```

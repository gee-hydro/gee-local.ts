# 本地运行与导出

本地运行层复现 GEE Code Editor 的常用入口，并将地图预览、影像下载和批量调度集中在独立模块中。

## 运行环境

```bash
ee script.js [more.js ...]       # 多脚本只鉴权一次
ee --repl
ee --package-path ./packages script.js
```

运行时注入 `ee`、`print`、`Map`、`Export`、`Chart` 和 `ui.Chart`。GEE 包使用 Code Editor 风格的 `require`，路径须带 `.js`。

## 地图预览

`Map.addLayer` 通过 MapLibre GL JS 生成 `maps/<脚本名>.html`，支持图层显隐、透明度、`centerObject`、`setCenter`、`setZoom` 和 `setOptions`。

终端运行脚本时，内置 HTTP 服务会自动启动并打开浏览器：

- `GEE_MAP_OPEN=0`：不自动打开浏览器；
- `GEE_MAP_SERVER=0`：不启动地图服务。

GEE 临时瓦片地址失效后，重新运行脚本即可。实现位于 `src/local/map.ts` 和 `src/local/map-server.ts`。

## 单景下载

用户入口为：

```js
await pkg.export_img(image, filename, options);
await pkg.export_img_grids(image, filename, options); // 切片下载并合并
```

`_host.getDownloadUrl()`、`_host.gdalWarp()` 和 GDAL 调用均由模块内部获取，业务脚本不得重复封装。

| 网格需求 | 参数 |
|---|---|
| 米制分辨率 | `region + scale` |
| 规则 WGS84 网格 | 数值 `region + cellsize` |
| 精确或特殊网格 | `crs + crsTransform` |

本包对外统一使用 `crsTransform`；仅构造 `Image.getDownloadURL` 请求时转换为 `crs_transform`。

切片下载通过 `tiling` 配置：

- `bounds`：完整输出范围；`dimensions`：可选的输出尺寸；
- `rows`、`cols`：切片行列数；
- `concurrency`：切片下载并发数；
- `resampling`、`srcNoData`、`dstNoData`、`dataType`：GDAL 合并参数。

实现位于 `src/export/export-img.ts` 和 `src/export/export-tile.ts`。

## 逐景与分组导出

数据流保持单向：

```text
listGroups → export_col → exportImage(group) → export_img
```

职责划分如下：

- `listGroups`：按时间分组，并生成 `prefix + 时段键`；
- `export_col`：并发调度已选分组，默认并发数为 4；
- `exportImage(group)`：筛选、mosaic、重采样和命名；
- `export_img`：下载、切片、重试和写文件。

常用选项：

- `period`：支持 `8d`、`1m`、`1y` 等周期，默认 `1d`；
- `groups`：直接下载预先筛选的分组；
- `indexProperty`：指定影像索引字段；
- `suffixPattern`：从 `system:index` 保留卫星等标识；
- `maxGroups=-1`：下载全部；`maxGroups=0`：不下载；
- `sceneRecord: { filename, properties }`：写出完整集合的影像记录。

质量筛选由 `src/export/frac_valid.ts` 独立完成并生成 CSV。批量调度实现位于 `src/export/export-col.ts`。

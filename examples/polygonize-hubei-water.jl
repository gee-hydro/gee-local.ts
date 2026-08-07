#!/usr/bin/env julia

# 将 frac_water 按阈值转为二值栅格，再以四邻域生成水体多边形。
using SpatialRasterLite
using ArchGDAL

length(ARGS) in (2, 3) || error(
  "用法：julia polygonize-hubei-water.jl input.tif output.shp [threshold]",
)
input, output = abspath.(ARGS[1:2])
threshold = length(ARGS) == 3 ? parse(Float64, ARGS[3]) : 0.5
0 <= threshold <= 1 || error("threshold 必须位于 [0, 1]")
mkpath(dirname(output))

src = SpatRaster(input)
ndims(src.A) in (2, 3) || error("输入 GeoTIFF 缺少 frac_water")
frac_water = ndims(src.A) == 2 ? src.A : src.A[:, :, 1]
water = UInt8.(isfinite.(frac_water) .& (frac_water .> threshold))
water_raster = SpatRaster(
  water,
  src.b;
  bands=["water"],
  name="water",
  nodata=UInt8(0),
)

stem = splitext(output)[1]
foreach((".shp", ".shx", ".dbf", ".prj", ".cpg", ".qix")) do ext
  rm(stem * ext; force=true)
end

temp = tempname() * ".tif"
try
  write_gdal(water_raster, temp; nodata=UInt8(0))
  gdal_polygonize(
    temp,
    output;
    bands=1,
    fieldname="water",
    nodata=0,
    mask=true,
    diag=false,
  )
finally
  rm(temp; force=true)
end

println("已保存：", output)

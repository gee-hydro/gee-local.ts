#!/usr/bin/env Rscript

# 验证 Shapefile 与 frac_water 阈值栅格逐像元一致，并绘制检查图。
suppressPackageStartupMessages({
  library(sf)
  library(terra)
})

args <- commandArgs(trailingOnly = TRUE)
if (!length(args) %in% 4:5) {
  stop(paste(
    "用法：Rscript validate-hubei-water-shapefile.R",
    "input.tif water.shp report.csv output.png [threshold]"
  ))
}

raster_file <- normalizePath(args[[1]], mustWork = TRUE)
shape_file <- normalizePath(args[[2]], mustWork = TRUE)
report_file <- args[[3]]
plot_file <- args[[4]]
threshold <- if (length(args) == 5L) as.numeric(args[[5]]) else 0.5
stopifnot(is.finite(threshold), threshold >= 0, threshold <= 1)
dir.create(dirname(report_file), recursive = TRUE, showWarnings = FALSE)
dir.create(dirname(plot_file), recursive = TRUE, showWarnings = FALSE)

frac_water <- rast(raster_file)[[1]]
water_raster <- ifel(is.na(frac_water), NA, frac_water > threshold)
water_shape <- st_read(shape_file, quiet = TRUE)
geometry_valid <- st_is_valid(water_shape)
stopifnot(
  st_crs(water_shape)$epsg == 4326,
  nrow(water_shape) > 0L,
  all(water_shape$water == 1L),
  all(!st_is_empty(water_shape)),
  all(geometry_valid)
)

polygon_raster <- rasterize(
  vect(water_shape),
  water_raster,
  field = "water",
  background = 0,
)
valid <- !is.na(water_raster)
cell_mismatch <- global(
  ifel(valid, water_raster != polygon_raster, NA),
  "sum",
  na.rm = TRUE
)[1, 1]
water_cells <- global(water_raster == 1, "sum", na.rm = TRUE)[1, 1]
raster_area <- global(
  ifel(water_raster == 1, cellSize(water_raster, unit = "km"), NA),
  "sum",
  na.rm = TRUE
)[1, 1]
vector_area <- sum(as.numeric(st_area(st_transform(water_shape, 6933)))) / 1e6
area_error <- abs(vector_area - raster_area) / raster_area

report <- data.frame(
  threshold = threshold,
  feature_count = nrow(water_shape),
  water_cells = water_cells,
  cell_mismatch = cell_mismatch,
  raster_area_km2 = raster_area,
  vector_area_km2 = vector_area,
  relative_area_error = area_error,
  crs_epsg = st_crs(water_shape)$epsg,
  all_valid = all(geometry_valid)
)
write.csv(report, report_file, row.names = FALSE)
print(report, row.names = FALSE)
stopifnot(cell_mismatch == 0, area_error < 0.01)

province <- ifel(!is.na(water_raster), 0, NA)
png(plot_file, width = 2400, height = 1800, res = 300, type = "cairo")
par(mar = c(1, 1, 3.5, 1), bg = "white")
plot(province, col = "#F2EFE9", legend = FALSE, axes = FALSE, box = FALSE)
plot(st_geometry(water_shape), add = TRUE, col = "#1769AA", border = NA)
title(
  sprintf("湖北省水体范围（frac_water > %.1f）", threshold),
  font.main = 2,
  cex.main = 1.25
)
legend(
  "bottomleft",
  fill = c("#F2EFE9", "#1769AA"),
  legend = c("非水体", "水体多边形"),
  border = NA,
  bty = "n",
  cex = 0.85
)
mtext(
  sprintf(
    "水体多边形：%d｜总面积：%.2f km²｜CRS：EPSG:4326",
    nrow(water_shape),
    vector_area
  ),
  side = 1,
  line = -0.3,
  cex = 0.7,
  col = "#555555"
)
dev.off()

message("验证通过：", report_file)
message("已保存：", plot_file)

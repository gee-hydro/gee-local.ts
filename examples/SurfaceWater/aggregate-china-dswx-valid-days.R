#!/usr/bin/env Rscript

suppressPackageStartupMessages(library(terra))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) {
  stop("用法：Rscript aggregate-china-dswx-valid-days.R monthly_dir year output.tif")
}

monthly_dir <- normalizePath(args[[1]], mustWork = TRUE)
year <- as.integer(args[[2]])
files <- sort(list.files(
  monthly_dir,
  pattern = paste0("China_DSWX_valid_days_", year, "[0-9]{2}_1-24deg\\.tif$"),
  full.names = TRUE
))
expected <- if (year == 2023L) 9L else if (year == 2026L) 8L else 12L
if (length(files) != expected) {
  stop("月份文件不完整：", length(files), "/", expected)
}

monthly <- rast(files)
monthly[monthly <= -9999] <- NA
inside <- app(!is.na(monthly), any)
monthly <- ifel(is.na(monthly), 0, monthly)
annual <- mask(sum(monthly), inside, maskvalues = 0)
mean_monthly <- annual / expected
names(annual) <- "annual_valid_day_count"
names(mean_monthly) <- "mean_monthly_valid_day_count"
dir.create(dirname(args[[3]]), recursive = TRUE, showWarnings = FALSE)
writeRaster(
  c(annual, mean_monthly),
  args[[3]],
  datatype = "FLT4S",
  NAflag = -9999,
  overwrite = TRUE,
  gdal = c("TILED=YES", "COMPRESS=DEFLATE")
)
message("已保存：", args[[3]])

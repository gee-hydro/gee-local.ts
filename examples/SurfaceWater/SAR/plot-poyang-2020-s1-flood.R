#!/usr/bin/env Rscript

suppressPackageStartupMessages(library(terra))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) {
  stop("用法：Rscript plot-poyang-2020-s1-flood.R input.tif output.png")
}

flood <- rast(normalizePath(args[[1]], mustWork = TRUE))
flood[flood == 255] <- NA
output <- args[[2]]
dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)

png(output, width = 2100, height = 2400, res = 300, type = "cairo")
par(mar = c(1, 1, 4, 1), bg = "white")
plot(
  flood,
  col = c("#F2EFE9", "#1976D2", "#E64A19"),
  breaks = c(-0.5, 0.5, 1.5, 2.5),
  axes = FALSE,
  legend = FALSE,
  box = FALSE
)
title("鄱阳湖区2020年洪水SAR识别试验", font.main = 2, cex.main = 1.2)
legend(
  "bottomleft",
  fill = c("#F2EFE9", "#1976D2", "#E64A19"),
  legend = c("非水体", "洪峰期水体", "新增淹没候选区"),
  border = NA,
  bty = "n",
  cex = 0.8
)
mtext(
  "Sentinel-1B：2020-06-20 → 2020-07-14｜30 m｜VV/VH Otsu变化检测",
  side = 1,
  line = -0.3,
  cex = 0.65,
  col = "#555555"
)
dev.off()
message("已保存：", output)

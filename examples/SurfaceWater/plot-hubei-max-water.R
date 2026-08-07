#!/usr/bin/env Rscript

suppressPackageStartupMessages(library(terra))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) {
  stop("用法：Rscript examples/plot-hubei-max-water.R input.tif output.png")
}

input <- normalizePath(args[[1]], mustWork = TRUE)
output <- args[[2]]
dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)

water <- rast(input)
water[water == 255] <- NA

png(output, width = 2400, height = 1800, res = 300, type = "cairo")
par(mar = c(1, 1, 3.5, 1), bg = "white")
plot(
  water,
  col = c("#F2EFE9", "#1769AA"),
  breaks = c(-0.5, 0.5, 1.5),
  axes = FALSE,
  legend = FALSE,
  box = FALSE
)
title("湖北省最大水体范围（1984—2021 年）", font.main = 2, cex.main = 1.25)
legend(
  "bottomleft",
  fill = c("#F2EFE9", "#1769AA"),
  legend = c("陆地", "最大水体范围"),
  border = NA,
  bty = "n",
  cex = 0.85
)
mtext(
  "JRC GSW v1.4｜空间分辨率：1/120°（约 1 km）｜数据来源：EC JRC/Google",
  side = 1,
  line = -0.3,
  cex = 0.7,
  col = "#555555"
)
dev.off()
message("已保存：", output)

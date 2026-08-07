#!/usr/bin/env Rscript

suppressPackageStartupMessages(library(terra))

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3L) {
  stop("用法：Rscript plot-hubei-water-fraction.R input.tif frac.png extent.png")
}

input <- normalizePath(args[[1]], mustWork = TRUE)
outputs <- args[2:3]
invisible(lapply(dirname(outputs), dir.create, recursive = TRUE, showWarnings = FALSE))

x <- rast(input)
if (nlyr(x) != 2L) stop("输入 GeoTIFF 必须包含 frac_water 和 water 两个波段")
names(x) <- c("frac_water", "water")
frac_water <- x[[1]]
water <- x[[2]]

save_plot <- function(file, draw) {
  png(file, width = 2400, height = 1800, res = 300, type = "cairo")
  on.exit(dev.off())
  par(mar = c(1, 1, 3.5, 1), bg = "white")
  draw()
  mtext(
    "JRC GSW v1.4｜seasonality ≥ 2｜网格：1/120°（约 1 km）｜EC JRC/Google",
    side = 1,
    line = -0.3,
    cex = 0.7,
    col = "#555555"
  )
  message("已保存：", file)
}

save_plot(outputs[[1]], function() {
  plot(
    frac_water,
    col = hcl.colors(100, "Blues 3", rev = TRUE),
    range = c(0, 1),
    axes = FALSE,
    box = FALSE,
    plg = list(title = "水体比例", shrink = 0.75)
  )
  title("湖北省 1/120° 网格水体比例", font.main = 2, cex.main = 1.25)
})

save_plot(outputs[[2]], function() {
  plot(
    water,
    col = c("#F2EFE9", "#1769AA"),
    breaks = c(-0.5, 0.5, 1.5),
    axes = FALSE,
    legend = FALSE,
    box = FALSE
  )
  title("湖北省水体范围（frac_water > 0.5）", font.main = 2, cex.main = 1.25)
  legend(
    "bottomleft",
    fill = c("#F2EFE9", "#1769AA"),
    legend = c("非水体", "水体"),
    border = NA,
    bty = "n",
    cex = 0.85
  )
})

#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(ggplot2)
  library(patchwork)
  library(tidyterra)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) {
  stop("用法：Rscript examples/plot-china-dswx-availability.R input_dir output.png")
}

files <- sort(list.files(
  args[[1]],
  pattern = "China_DSWX_valid_count_[0-9]{4}_1-24deg\\.tif$",
  full.names = TRUE
))
if (!length(files)) stop("未找到有效观测数 TIF")

years <- sub(".*count_([0-9]{4})_.*", "\\1", files)
rasters <- lapply(files, function(file) {
  raster <- terra::rast(file)
  raster[raster <= -9999] <- NA
  raster
})
annual <- do.call(c, lapply(rasters, `[[`, 1))
monthly <- do.call(c, lapply(rasters, `[[`, 2))
names(annual) <- years
names(monthly) <- years

metric_plot <- function(raster, title) {
  ggplot() +
    geom_spatraster(data = raster, maxcell = 8e5) +
    scale_fill_gradientn(
      colours = c("#F7FBFF", "#C6DBEF", "#6BAED6", "#2171B5", "#08306B"),
      labels = scales::label_number(accuracy = 1),
      na.value = "transparent",
      name = "有效数值数"
    ) +
    facet_wrap(~lyr, ncol = 2) +
    coord_sf(expand = FALSE) +
    labs(title = title, x = NULL, y = NULL) +
    theme_void(base_size = 11) +
    theme(
      plot.title = element_text(face = "bold"),
      legend.position = "bottom",
      legend.key.width = unit(3, "cm"),
      strip.text = element_text(face = "bold")
    ) +
    guides(fill = guide_colorbar(title.position = "top"))
}

annual_plot <- metric_plot(annual, "年有效观测数")
monthly_plot <- metric_plot(monthly, "平均每月有效观测数")
if (length(files) == 1L) {
  plot <- annual_plot + monthly_plot
  height <- 5.7
} else {
  plot <- annual_plot / monthly_plot
  height <- 10
}
plot <- plot + plot_annotation(
  title = "中国 OPERA DSWx-HLS 有效观测数",
  subtitle = "1/24° 网格中心点；BWTR 为 0 或 1 时计为有效"
)

dir.create(dirname(args[[2]]), recursive = TRUE, showWarnings = FALSE)
ggsave(args[[2]], plot, width = 10, height = height, dpi = 300, bg = "white")
message("已保存：", args[[2]])

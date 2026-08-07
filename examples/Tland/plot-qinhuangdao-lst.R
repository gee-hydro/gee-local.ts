#!/usr/bin/env Rscript

suppressPackageStartupMessages({
  library(ggplot2)
  library(tidyterra)
})

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 2L) {
  stop("用法：Rscript examples/plot-qinhuangdao-lst.R input.tif output.png")
}

input <- normalizePath(args[[1]], mustWork = TRUE)
output <- args[[2]]
dir.create(dirname(output), recursive = TRUE, showWarnings = FALSE)

lst <- terra::rast(input)
lst[lst <= -9999] <- NA
names(lst) <- "LST_C"

date <- sub(".*_([0-9]{8})_90m$", "\\1", tools::file_path_sans_ext(basename(input)))
if (grepl("^[0-9]{8}$", date)) {
  date <- format(as.Date(date, "%Y%m%d"), "%Y-%m-%d")
}

plot <- ggplot() +
  geom_spatraster(data = lst) +
  scale_fill_gradientn(
    colours = c(
      "#9270DB", "#0204C9", "#4169E7", "#80A9F0", "#ACE3EA", "#9AECD4",
      "#E6C999", "#F8D11C", "#FFAC00", "#FF4C00", "#B42221", "#FFB2B2"
    ),
    na.value = "transparent",
    name = "地表温度 (°C)"
  ) +
  labs(
    title = "秦皇岛市 Landsat 7/8/9 地表温度",
    subtitle = date,
    x = NULL,
    y = NULL
  ) +
  coord_sf(expand = FALSE) +
  theme_void(base_size = 12) +
  theme(
    plot.title = element_text(face = "bold"),
    legend.position = "bottom",
    legend.key.width = unit(3, "cm")
  ) +
  guides(fill = guide_colorbar(title.position = "top"))

ggsave(output, plot, width = 8, height = 6, dpi = 300, bg = "white")
message("已保存：", output)

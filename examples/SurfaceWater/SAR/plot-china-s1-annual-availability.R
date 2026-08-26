library(data.table)
library(ggplot2)
library(terra)

indir <- 'data/china_s1_annual_availability_025deg'
outfile <- 'images/china-s1-annual-availability-025deg.png'
files <- sort(list.files(indir, '\\.tif$', full.names = TRUE))
stopifnot(length(files) > 0)

dt <- rbindlist(lapply(files, function(file) {
  x <- as.data.table(as.data.frame(rast(file), xy = TRUE, na.rm = FALSE))
  setnames(x, 3, 'count')
  x[count < 0, count := NA_real_]
  x[, year := sub('.*_(\\d{4})_025deg\\.tif$', '\\1', file)]
  x[!is.na(count)]
}))
dt[, year := factor(year, levels = unique(year))]
n_rows <- ceiling(uniqueN(dt$year) / 3)

p <- ggplot(dt, aes(x, y, fill = count)) +
  geom_raster() +
  facet_wrap(~year, ncol = 3) +
  scale_fill_viridis_c(
    option = 'C', trans = 'sqrt',
    breaks = c(0, 10, 25, 50, 100, 150),
    name = '有效观测数\n（景/年）',
  ) +
  coord_quickmap(expand = FALSE) +
  labs(
    title = '中国 Sentinel-1 年有效观测数',
    subtitle = 'IW模式、VV/VH双极化；0.25°代表网格',
    x = NULL, y = NULL,
  ) +
  theme_minimal(base_size = 12) +
  theme(
    plot.title = element_text(face = 'bold', size = 18),
    plot.subtitle = element_text(colour = 'grey35'),
    panel.grid = element_blank(),
    panel.background = element_rect(fill = 'grey94', colour = NA),
    strip.text = element_text(face = 'bold'),
    axis.text = element_text(colour = 'grey35'),
    legend.position = 'right',
  )

dir.create(dirname(outfile), recursive = TRUE, showWarnings = FALSE)
ggsave(
  outfile, p,
  width = 12, height = 2.3 + 2.2 * n_rows,
  dpi = 200, bg = 'white',
)
cat(outfile, '\n')

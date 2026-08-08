#!/usr/bin/env python3
"""绘制湖北省 SRTM 地形、水体与三类区域定位图。"""

import os
import sys
from pathlib import Path

os.environ.setdefault('PROJ_DATA', '/usr/share/proj')
os.environ.setdefault('PROJ_LIB', '/usr/share/proj')

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.cm import ScalarMappable
from matplotlib.colors import LightSource, LinearSegmentedColormap, Normalize
from matplotlib.lines import Line2D
from matplotlib.patches import Patch, Rectangle
from mpl_toolkits.axes_grid1.anchored_artists import AnchoredSizeBar
from osgeo import gdal, osr
from scipy.ndimage import distance_transform_edt

if len(sys.argv) != 4:
    raise SystemExit('用法：plot-hubei-terrain-water.py dem_250m.tif water.shp output.png')

dem_file, water_file, output = map(Path, sys.argv[1:])
output.parent.mkdir(parents=True, exist_ok=True)
gdal.UseExceptions()

FONT = 'Noto Sans CJK SC'
BG = '#f5f2ea'
WATER = '#006da8'
REGIONS = [
    ('鄂西山区', (108.40, 29.05, 112.35, 33.28), '#b76b3a'),
    ('中部江汉平原', (111.60, 29.25, 114.25, 31.85), '#bd9418'),
    ('鄂东湖区', (113.60, 29.05, 116.13, 31.75), '#2678a6'),
]

plt.rcParams.update({
    'font.family': 'sans-serif',
    'font.sans-serif': [FONT],
    'axes.unicode_minus': False,
    'figure.facecolor': BG,
    'savefig.facecolor': BG,
})


def project_factory(target_wkt):
    source = osr.SpatialReference()
    source.ImportFromEPSG(4326)
    target = osr.SpatialReference()
    target.ImportFromWkt(target_wkt)
    source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    transform = osr.CoordinateTransformation(source, target)
    return lambda lon, lat: transform.TransformPoint(lon, lat)[:2]


def projected_bounds(bounds, project):
    xmin, ymin, xmax, ymax = bounds
    points = [
        project(xmin, ymin), project(xmin, ymax),
        project(xmax, ymin), project(xmax, ymax),
    ]
    x, y = zip(*points)
    return min(x), min(y), max(x), max(y)


def rasterize_water(dataset, vector_file):
    target = '/vsimem/hubei_water_utm.gpkg'
    try:
        gdal.Unlink(target)
    except RuntimeError:
        pass
    vector = gdal.VectorTranslate(
        target,
        str(vector_file),
        format='GPKG',
        dstSRS=dataset.GetProjection(),
    )
    mask_ds = gdal.GetDriverByName('MEM').Create(
        '', dataset.RasterXSize, dataset.RasterYSize, 1, gdal.GDT_Byte
    )
    mask_ds.SetGeoTransform(dataset.GetGeoTransform())
    mask_ds.SetProjection(dataset.GetProjection())
    mask_ds.GetRasterBand(1).Fill(0)
    gdal.RasterizeLayer(
        mask_ds,
        [1],
        vector.GetLayer(),
        burn_values=[1],
        options=['ALL_TOUCHED=TRUE'],
    )
    mask = mask_ds.ReadAsArray().astype(bool)
    vector = None
    mask_ds = None
    gdal.Unlink(target)
    return mask


def make_relief(elevation, valid, water):
    nearest = distance_transform_edt(
        ~valid,
        return_distances=False,
        return_indices=True,
    )
    filled = np.maximum(elevation[tuple(nearest)], 0)
    cmap = LinearSegmentedColormap.from_list(
        'terrain',
        ['#eee9d5', '#cfd3a5', '#93a876', '#5f7d5b', '#455c49', '#756b60', '#d8d5cf'],
    )
    light = LightSource(azdeg=315, altdeg=38)
    base = cmap(Normalize(0, 2600)(filled))
    hillshade = light.hillshade(
        filled,
        vert_exag=2.4,
        dx=250,
        dy=250,
        fraction=1.2,
    )
    relief = base.copy()
    relief[..., :3] = np.clip(
        base[..., :3] * (0.52 + 0.72 * hillshade[..., None]),
        0,
        1,
    )
    relief[..., 3] = valid
    relief[water & valid] = matplotlib.colors.to_rgba(WATER)
    return relief, cmap


dataset = gdal.Open(str(dem_file))
band = dataset.GetRasterBand(1)
elevation = band.ReadAsArray().astype(np.float32)
nodata = band.GetNoDataValue()
valid = np.isfinite(elevation) & (elevation != nodata)
water = rasterize_water(dataset, water_file)
relief, terrain_cmap = make_relief(elevation, valid, water)

gt = dataset.GetGeoTransform()
xmin = gt[0]
xmax = gt[0] + dataset.RasterXSize * gt[1]
ymax = gt[3]
ymin = gt[3] + dataset.RasterYSize * gt[5]
extent = (xmin, xmax, ymin, ymax)
project = project_factory(dataset.GetProjection())

fig, ax = plt.subplots(figsize=(14, 8.6), dpi=260)
fig.subplots_adjust(left=0.035, right=0.965, bottom=0.16, top=0.88)
ax.imshow(relief, extent=extent, origin='upper', interpolation='bilinear')
ax.set(xticks=[], yticks=[])
ax.set_aspect('equal')
ax.set_facecolor(BG)
for spine in ax.spines.values():
    spine.set_visible(False)

for name, bounds, color in REGIONS:
    x0, y0, x1, y1 = projected_bounds(bounds, project)
    ax.add_patch(Rectangle(
        (x0, y0), x1 - x0, y1 - y0,
        fill=False,
        edgecolor=color,
        linewidth=2.0,
        linestyle=(0, (6, 3)),
        alpha=0.95,
    ))

region_handles = [
    Line2D([0], [0], color=color, lw=2.5, linestyle=(0, (6, 3)), label=name)
    for name, _, color in REGIONS
]
region_handles.append(Patch(facecolor=WATER, edgecolor='none', label='水体'))
ax.legend(
    handles=region_handles,
    loc='lower center',
    bbox_to_anchor=(0.5, -0.115),
    ncol=4,
    frameon=False,
    fontsize=10,
    handlelength=3,
    columnspacing=2.2,
)

scale = AnchoredSizeBar(
    ax.transData,
    100000,
    '100 km',
    loc='lower left',
    pad=0.45,
    borderpad=0.9,
    sep=5,
    color='#242424',
    frameon=False,
    size_vertical=2200,
    fontproperties={'family': FONT, 'size': 9},
)
ax.add_artist(scale)
ax.annotate(
    'N',
    xy=(0.95, 0.91),
    xytext=(0.95, 0.79),
    xycoords='axes fraction',
    textcoords='axes fraction',
    ha='center',
    va='center',
    fontsize=11,
    fontweight='bold',
    arrowprops=dict(arrowstyle='-|>', lw=1.4, color='#242424'),
)

cax = fig.add_axes([0.34, 0.075, 0.32, 0.018])
colorbar = fig.colorbar(
    ScalarMappable(norm=Normalize(0, 2600), cmap=terrain_cmap),
    cax=cax,
    orientation='horizontal',
)
colorbar.set_label('高程（m）', fontsize=9, labelpad=3)
colorbar.ax.tick_params(labelsize=8, length=2)

fig.suptitle('湖北省地貌、水体与区域定位', fontsize=23, fontweight='bold', y=0.955, color='#202522')
fig.text(
    0.5, 0.025,
    '高程与地形阴影：NASA/USGS SRTM（250 m）    水体：JRC GSW v1.4（seasonality ≥ 2，frac_water > 0.3）    投影：WGS 84 / UTM 49N',
    ha='center',
    fontsize=9,
    color='#66635e',
)
fig.savefig(output, dpi=260, facecolor=BG)
plt.close(fig)
print(f'已保存：{output}')

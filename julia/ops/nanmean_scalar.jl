# 示例：全域均值 → 标量（2D/3D 同一入口）
using NaNStatistics
using SpatialRasterLite

function apply(ra::SpatRaster; kwargs...)
    nanmean(Float64.(ra.A))
end

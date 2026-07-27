# 示例：时间维均值。2D 原样/标量；3D → 2D
# 统一签名: apply(ra::SpatRaster; params...)
using Statistics
using SpatialRasterLite

function apply(ra::SpatRaster; dims=3, kwargs...)
    A = ra.A
    if ndims(A) == 2
        return ra
    end
    d = Int(dims)
    m = dropdims(mean(Float64.(A); dims=d); dims=d)
    return SpatRaster(m, ra)   # 2D 结果，模板继承 bbox
end

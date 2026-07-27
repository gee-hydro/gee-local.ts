#!/usr/bin/env julia
# JSON-Lines worker：SpatialRasterLite 本地栅格
#
# TIFF  → SpatialRasterLite (ArchGDAL)
# NetCDF → NCDatasets 读时空 + 装配 SpatRaster
#
# 用户函数: apply(ra::SpatRaster; params...)  # ra.A: (nx,ny)|(nx,ny,nt)
# op: ping | info | inspect | crop | apply | shutdown

using SpatialRasterLite
using ArchGDAL
using NCDatasets
using JSON3
using SHA
using Dates

const FN_CACHE = Dict{String,Any}()

function bounds_to_bbox(b)
    bbox(Float64(b.west), Float64(b.south), Float64(b.east), Float64(b.north))
end

function bbox_to_bounds(b::bbox)
    (; west=b.xmin, south=b.ymin, east=b.xmax, north=b.ymax)
end

function as_dict(x)::Dict{String,Any}
    x isa AbstractDict && return Dict{String,Any}(String(k) => v for (k, v) in pairs(x))
    Dict{String,Any}(String(k) => v for (k, v) in pairs(x))
end

function day_str(x)::String
    if x isa Date
        return string(x)
    elseif x isa DateTime
        return string(Date(x))
    elseif x isa AbstractString
        return String(first(String(x), 10))
    else
        return string(x)[1:min(10, end)]
    end
end

# ── TIFF（SpatialRasterLite）──────────────────────────────────

function inspect_tif(f::AbstractString)
    ra = SpatRaster(f)
    bands = try
        bandnames(f)
    catch
        nothing
    end
    nd = ndims(ra.A)
    (;
        format="tif",
        path=f,
        bounds=bbox_to_bounds(st_bbox(ra)),
        ndims=nd >= 3 ? 3 : 2,
        size=collect(size(ra.A)),
        bands=bands,
        band=bands isa AbstractVector && !isempty(bands) ? string(bands[1]) : nothing,
        cellsize=collect(st_cellsize(ra)),
        times=ra.time === nothing ? nothing : day_str.(ra.time),
        start=ra.time === nothing ? nothing : day_str(ra.time[1]),
        var"end"=ra.time === nothing ? nothing : day_str(ra.time[end]),
    )
end

# ── NetCDF（NCDatasets）───────────────────────────────────────

function _nc_dim_names(ds)
    String[string(k) for k in keys(ds.dim)]
end

function _pick_dim(names::Vector{String}, cands::Vector{String})
    lower = lowercase.(names)
    for c in cands
        i = findfirst(==(c), lower)
        i !== nothing && return names[i]
    end
    nothing
end

function _nc_data_vars(ds, lon_n, lat_n, time_n)
    out = String[]
    for k in keys(ds)
        k in (lon_n, lat_n, time_n) && continue
        v = ds[k]
        hasproperty(v, :var) || continue
        dnames = String[string(d) for d in dimnames(v)]
        (lon_n in dnames && lat_n in dnames) || continue
        push!(out, String(k))
    end
    out
end

function inspect_nc(f::AbstractString; band=nothing)
    ds = NCDataset(f)
    try
        dims = _nc_dim_names(ds)
        lon_n = _pick_dim(dims, ["lon", "longitude", "x"])
        lat_n = _pick_dim(dims, ["lat", "latitude", "y"])
        time_n = _pick_dim(dims, ["time", "t", "date"])
        lon_n === nothing && error("nc 无 lon/longitude 维: $f")
        lat_n === nothing && error("nc 无 lat/latitude 维: $f")

        lon = Float64.(ds[lon_n][:])
        lat = Float64.(ds[lat_n][:])
        # 中心点 → 角点 bbox
        dx = length(lon) > 1 ? abs(lon[2] - lon[1]) : 0.0
        dy = length(lat) > 1 ? abs(lat[2] - lat[1]) : 0.0
        b = bbox(minimum(lon) - dx / 2, minimum(lat) - dy / 2,
                 maximum(lon) + dx / 2, maximum(lat) + dy / 2)

        times = nothing
        t0 = t1 = nothing
        if time_n !== nothing
            rawt = ds[time_n][:]
            times = day_str.(rawt)
            t0, t1 = times[1], times[end]
        end

        vars = _nc_data_vars(ds, lon_n, lat_n, time_n)
        var = band !== nothing ? String(band) :
              (!isempty(vars) ? vars[1] : error("nc 无数据变量"))
        var in vars || band === nothing || error("nc 无变量 $var；可选: $(join(vars, ","))")

        nd = time_n === nothing ? 2 : 3
        sz = time_n === nothing ? [length(lon), length(lat)] :
             [length(lon), length(lat), length(times)]

        return (;
            format="nc",
            path=f,
            bounds=bbox_to_bounds(b),
            ndims=nd,
            size=sz,
            bands=vars,
            band=var,
            times=times,
            start=t0,
            var"end"=t1,
            cellsize=[dx, lat[end] >= lat[1] ? dy : -dy],
        )
    finally
        close(ds)
    end
end

"""读 nc → SpatRaster；可选 band、时间闭区间 [t0,t1]、空间 crop。"""
function read_nc(f::AbstractString; band=nothing, t0=nothing, t1=nothing, b::Union{bbox,Nothing}=nothing)
    ds = NCDataset(f)
    try
        dims = _nc_dim_names(ds)
        lon_n = _pick_dim(dims, ["lon", "longitude", "x"])
        lat_n = _pick_dim(dims, ["lat", "latitude", "y"])
        time_n = _pick_dim(dims, ["time", "t", "date"])
        lon_n === nothing && error("nc 无 lon 维")
        lat_n === nothing && error("nc 无 lat 维")

        vars = _nc_data_vars(ds, lon_n, lat_n, time_n)
        var = band !== nothing ? String(band) : vars[1]
        v = ds[var]
        dnames = String[string(d) for d in dimnames(v)]

        lon = Float64.(ds[lon_n][:])
        lat = Float64.(ds[lat_n][:])
        Afull = Array(v)  # 按 nc 维序

        # 置换为 (lon, lat[, time])
        order = Int[]
        for name in (lon_n, lat_n, time_n)
            name === nothing && continue
            i = findfirst(==(name), dnames)
            i === nothing && continue
            push!(order, i)
        end
        A = permutedims(Afull, Tuple(order))

        times = nothing
        if time_n !== nothing
            times = day_str.(ds[time_n][:])
            if t0 !== nothing || t1 !== nothing
                s = t0 === nothing ? times[1] : day_str(t0)
                e = t1 === nothing ? times[end] : day_str(t1)
                idx = findall(t -> s <= t <= e, times)
                isempty(idx) && error("时间筛选无数据 $s..$e")
                A = ndims(A) == 3 ? A[:, :, idx] : A
                times = times[idx]
            end
        end

        dx = length(lon) > 1 ? abs(lon[2] - lon[1]) : 0.0
        dy = length(lat) > 1 ? abs(lat[2] - lat[1]) : 0.0
        box = bbox(minimum(lon) - dx / 2, minimum(lat) - dy / 2,
                   maximum(lon) + dx / 2, maximum(lat) + dy / 2)
        ra = SpatRaster(A, box; time=times, name=var, bands=[var])
        return b === nothing ? ra : st_crop(ra, b)
    finally
        close(ds)
    end
end

function inspect_path(path; format=nothing, band=nothing)
    f = abspath(String(path))
    isfile(f) || error("file not found: $f")
    fmt = format === nothing ? lowercase(splitext(f)[2]) : lowercase(String(format))
    if fmt in (".tif", ".tiff", "tif", "tiff")
        return inspect_tif(f)
    elseif fmt in (".nc", ".nc4", "nc", "nc4")
        return inspect_nc(f; band=band)
    else
        # 回退扩展名
        ext = lowercase(splitext(f)[2])
        ext in (".tif", ".tiff") && return inspect_tif(f)
        ext in (".nc", ".nc4") && return inspect_nc(f; band=band)
        error("未知格式: $fmt path=$f")
    end
end

# ── 用户函数 / cube ───────────────────────────────────────────

function load_user_fn(req)
    name = String(haskey(req, :fn_name) ? req.fn_name : "apply")
    if haskey(req, :fn_file)
        f = abspath(String(req.fn_file))
        isfile(f) || error("fn_file not found: $f")
        key = "file:" * f * "#" * name * "#" * string(mtime(f))
        return get!(FN_CACHE, key) do
            mod = Module(gensym("UserFn"))
            Core.eval(mod, :(using SpatialRasterLite))
            Base.include(mod, f)
            isdefined(mod, Symbol(name)) || error("fn `$name` not defined in $f")
            getfield(mod, Symbol(name))
        end
    elseif haskey(req, :fn_code)
        code = String(req.fn_code)
        key = "code:" * bytes2hex(sha256(code)) * "#" * name
        return get!(FN_CACHE, key) do
            mod = Module(gensym("UserFn"))
            Core.eval(mod, :(using SpatialRasterLite))
            include_string(mod, code, "fn_code")
            isdefined(mod, Symbol(name)) || error("fn `$name` not defined in fn_code")
            getfield(mod, Symbol(name))
        end
    else
        error("apply 需要 fn_file 或 fn_code")
    end
end

function is_nc(path::AbstractString)
    ext = lowercase(splitext(path)[2])
    ext in (".nc", ".nc4")
end

"""读单文件；tif→SpatialRasterLite，nc→NCDatasets。"""
function read_one(path::AbstractString, b::Union{bbox,Nothing};
    band=nothing, t0=nothing, t1=nothing)
    f = abspath(String(path))
    isfile(f) || error("file not found: $f")
    if is_nc(f)
        return read_nc(f; band=band, t0=t0, t1=t1, b=b)
    end
    ra = SpatRaster(f)
    b === nothing ? ra : st_crop(ra, b)
end

function load_cube(paths, times, bounds; band=nothing, t0=nothing, t1=nothing)
    b = bounds === nothing ? nothing : bounds_to_bbox(bounds)
    n = length(paths)
    n >= 1 || error("paths 为空")

    if n == 1
        ra = read_one(paths[1], b; band=band, t0=t0, t1=t1)
        if times !== nothing && length(times) >= 1 && ra.time === nothing
            ra.time = [String(times[1])]
        end
        return ra
    end

    # 多 tif stack → 3D
    slices = Vector{AbstractMatrix}(undef, n)
    ra0 = nothing
    for i in 1:n
        is_nc(paths[i]) && error("stack 多路径暂不支持混入 nc；请对 nc 单路径 + 时间筛选")
        ra = read_one(paths[i], b)
        A = ra.A
        if ndims(A) == 2
            slices[i] = A
        elseif ndims(A) == 3 && size(A, 3) == 1
            slices[i] = @view A[:, :, 1]
        else
            error("stack 要求每景 2D，收到 size=$(size(A))")
        end
        i == 1 && (ra0 = ra)
        i > 1 && size(slices[i]) != size(slices[1]) &&
            error("空间尺寸不一致")
    end
    T = float(eltype(slices[1]))
    A3 = Array{T}(undef, size(slices[1])..., n)
    for i in 1:n
        A3[:, :, i] .= slices[i]
    end
    t = times === nothing ? nothing : String[String(x) for x in times]
    SpatRaster(A3, ra0.b; time=t, name=ra0.name, nodata=ra0.nodata)
end

function kw_from_params(params)
    params === nothing && return NamedTuple()
    d = as_dict(params)
    isempty(d) && return NamedTuple()
    (; Dict(Symbol(k) => v for (k, v) in d)...)
end

function encode_result(y, template::SpatRaster, out)
    if y isa AbstractSpatRaster
        ra = y
        outpath = out !== nothing ? abspath(String(out)) : tempname() * ".tif"
        mkpath(dirname(outpath))
        st_write(ra, outpath)
        return (;
            type="raster",
            out=outpath,
            bbox=bbox_to_bounds(st_bbox(ra)),
            ndims=ndims(ra.A),
            size=collect(size(ra.A)),
        )
    elseif y isa AbstractArray{<:Real} && ndims(y) >= 2
        return encode_result(SpatRaster(y, template), template, out)
    elseif y isa Real
        return (; type="scalar", value=Float64(y))
    elseif y isa AbstractVector
        return (; type="vector", value=collect(Float64, y))
    elseif y isa NamedTuple || y isa AbstractDict
        return (; type="json", value=y)
    else
        error("不支持的返回类型: $(typeof(y))")
    end
end

function handle_apply(req)
    paths = String[String(p) for p in req.paths]
    times = haskey(req, :times) && req.times !== nothing ?
            String[String(t) for t in req.times] : nothing
    bounds = haskey(req, :bounds) ? req.bounds : nothing
    out = haskey(req, :out) ? req.out : nothing
    params = haskey(req, :params) ? req.params : nothing
    band = haskey(req, :band) ? req.band : nothing
    t_start = haskey(req, :start) ? req.start : nothing
    t_end = haskey(req, :end) ? req.end : nothing

    f = load_user_fn(req)
    ra = load_cube(paths, times, bounds; band=band, t0=t_start, t1=t_end)
    kw = kw_from_params(params)
    y = isempty(kw) ? Base.invokelatest(f, ra) : Base.invokelatest(f, ra; kw...)
    encode_result(y, ra, out)
end

function handle(req)
    op = String(req.op)
    if op == "ping"
        return (; pong=true)
    elseif op == "shutdown"
        return (; bye=true)
    elseif op == "info" || op == "inspect"
        band = haskey(req, :band) ? req.band : nothing
        format = haskey(req, :format) ? req.format : nothing
        return inspect_path(req.path; format=format, band=band)
    elseif op == "crop"
        f = abspath(String(req.path))
        isfile(f) || error("file not found: $f")
        out = abspath(String(req.out))
        mkpath(dirname(out))
        b = bounds_to_bbox(req.bounds)
        band = haskey(req, :band) ? req.band : nothing
        ra = is_nc(f) ? read_nc(f; band=band, b=b) : st_crop(f, b)
        # crop 结果统一写 tif
        st_write(ra isa SpatRaster ? ra : SpatRaster(ra, b), out)
        ra2 = ra isa SpatRaster ? ra : SpatRaster(out)
        return (; out=out, bbox=bbox_to_bounds(st_bbox(ra2)))
    elseif op == "apply"
        return handle_apply(req)
    else
        error("unknown op: $op")
    end
end

function reply(id, ok; result=nothing, error=nothing)
    msg = ok ? (; id=id, ok=true, result=result) : (; id=id, ok=false, error=error)
    println(JSON3.write(msg))
    flush(stdout)
end

for line in eachline(stdin)
    isempty(strip(line)) && continue
    local id = 0
    try
        req = JSON3.read(line)
        id = Int(req.id)
        result = handle(req)
        reply(id, true; result=result)
        String(req.op) == "shutdown" && break
    catch e
        reply(id, false; error=sprint(showerror, e))
    end
end

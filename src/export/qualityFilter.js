var io = require('./IO.js');
var util = require('./utilize.js');

function cal_frac_valid(image, options) {
  var valid = ee.Image(image)
    .mask()
    .rename('valid')
    .unmask(0, false);
  return ee.Number(valid.reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: options.targetRegion,
    scale: options.qualityScale,
    maxPixels: 1e8,
    tileScale: 2,
  }).get('valid'));
}

function readCsv(filename) {
  var rows = io.read_csv(filename);
  rows.forEach(function (row) {
    row.source_count = Number(row.source_count);
    row.frac_valid = Number(row.frac_valid);
  });
  return new Map(rows.map(function (row) {
    return [row.group_key, row];
  }));
}

function writeCsv(filename, records) {
  io.write_csv(filename, records, [
    'group_key',
    'filename',
    'source_count',
    'frac_valid',
  ]);
}

/**
 * 计算单个分组的有效观测比例，并生成质量记录。
 * @param {Object} group 时间分组及其影像索引。
 * @param {Object} options 影像集合、构建函数及质量参数。
 * @returns {Promise<Object>} 包含分组键、文件名、来源数量和质量值的记录。
 */
async function assess(group, options) {
  var source = options.collection.filter(globalThis.ee.Filter.inList(
    options.indexProperty || 'system:index',
    group.indices,
  ));
  var image = options.buildImage(source, options.buildImageOptions);
  var quality = Number(await util.evaluate(
    cal_frac_valid(image, options.qualityOptions),
  ));
  var record = {
    group_key: group.key,
    filename: group.name + (options.extension || '.tif'),
    source_count: group.indices.length,
  };
  record.frac_valid = Number.isFinite(quality) ? quality : 0;
  return record;
}

/**
 * 复用质量缓存，评估缺失分组并筛选达到阈值的分组。
 * @param {Object[]} groups 待处理的时间分组。
 * @param {Object} options 质量筛选配置。
 * @returns {Promise<Object[]>} 达到质量阈值的时间分组。
 */
async function qualityFilter(groups, options) {
  var records = readCsv(options.allFile);
  var step = options.concurrency || 4;

  for (var i = 0; i < groups.length; i += step) {
    var pending = groups.slice(i, i + step).filter(function (group) {
      return !records.has(group.key);
    });
    if (!pending.length) continue;

    var batch = await Promise.all(pending.map(function (group) {
      return assess(group, options);
    }));
    batch.forEach(function (record) {
      records.set(record.group_key, record);
      console.log('[quality] ' + record.group_key + ': ' +
        record.frac_valid.toFixed(6));
    });
    writeCsv(options.allFile, Array.from(records.values()));
  }

  var selected = Array.from(records.values()).filter(function (record) {
    return record.frac_valid >= options.qualityOptions.minQuality;
  });
  writeCsv(options.selectedFile, selected);

  var selected_keys = new Set(selected.map(function (record) {
    return record.group_key;
  }));
  return groups.filter(function (group) {
    return selected_keys.has(group.key);
  });
}

module.exports = qualityFilter;

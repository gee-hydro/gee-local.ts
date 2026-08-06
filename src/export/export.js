var fs = require('node:fs');
var path = require('node:path');
var taskInfo = require('./taskInfo.js');
var tile = require('./export-tile.js');
var util = require('./utilize.js');

function getDownloadParams(name, group, region, options) {
  if (options.getDownloadParams) {
    return options.getDownloadParams(name, group, region, options);
  }
  return {
    name: name,
    region: region,
    format: options.format || 'GEO_TIFF',
    filePerBand: options.filePerBand || false,
  };
}

async function downloadFile(image, params, filename, group, options, host) {
  var retries = options.retries == null ? 5 : Number(options.retries);
  var lastError = '';
  for (var attempt = 0; attempt < retries; attempt += 1) {
    var url = await host.getDownloadUrl(image, params);
    var response = await (options.fetch || fetch)(url);
    if (response.ok) {
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, Buffer.from(await response.arrayBuffer()));
      return filename;
    }

    lastError = typeof response.text === 'function'
      ? await response.text()
      : 'HTTP ' + response.status;
    if (response.status !== 429 && response.status !== 503) break;
    await new Promise(function (resolve) {
      setTimeout(resolve, 2000 * Math.pow(2, attempt));
    });
  }
  throw new Error('下载失败：' + group.key + ': ' + lastError);
}

async function export_img(col, group, position, total, options) {
  var name = group.name;
  var filename = options.getFilename
    ? options.getFilename(name, group, options)
    : path.join(options.outdir, name + (options.extension || '.tif'));
  if (fs.existsSync(filename)) {
    util.log(options, '[' + position + '/' + total + '] 跳过：' + path.basename(filename));
    return filename;
  }

  var host = globalThis._host;
  if (!host || !host.getDownloadUrl) {
    throw new Error('getDownloadUrl 仅在 gee-helper 本地运行时可用');
  }
  var source;
  if (options.getSource) {
    source = options.getSource(group, options);
  } else {
    var ee = globalThis.ee;
    if (!ee || !ee.Filter) {
      throw new Error('默认数据源筛选仅在 gee-helper 本地运行时可用');
    }
    source = col.filter(ee.Filter.inList(
      options.indexProperty || 'system:index',
      group.indices,
    ));
  }
  var image = options.buildImage(source, options.buildImageOptions);

  if (!options.tiling) {
    var params = getDownloadParams(name, group, options.region, options);
    await downloadFile(image, params, filename, group, options, host);
  } else {
    await tile.exportTiles({
      image,
      filename,
      group,
      options,
      host,
      downloadFile,
      getDownloadParams,
    });
  }

  util.log(options, '[' + position + '/' + total + '] 完成：' + path.basename(filename));
  return filename;
}


async function listGroups(col, options) {
  var maxGroups = options.maxGroups == null ? -1 : Number(options.maxGroups);
  if (!Number.isInteger(maxGroups) || maxGroups < -1) {
    throw new Error('maxGroups 须为 -1 或非负整数');
  }

  var groups = options.groups;
  if (!groups) {
    var period = util.parsePeriod(options.period || '1d');
    var values = await Promise.all([
      util.evaluate(col.aggregate_array(
        options.indexProperty || 'system:index',
      )),
      util.evaluate(col.aggregate_array(
        options.timeProperty || 'system:time_start',
      )),
    ]);
    groups = util.split_group(
      values[0],
      values[1],
      period,
      options.prefix,
      options.suffixPattern,
    );
  }
  return maxGroups < 0 ? groups : groups.slice(0, maxGroups);
}

async function runConcurrent(items, concurrency, task) {
  var cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      var index = cursor;
      cursor += 1;
      await task(items[index], index);
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(concurrency, items.length) },
    worker,
  ));
}

async function exportCollection(col, options) {
  var concurrency = options.concurrency == null ? 4 : Number(options.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency 须为正整数');
  }

  var groups = await listGroups(col, options);
  if (options.sceneRecord) {
    await taskInfo.export_taskInfo(
      col,
      options.sceneRecord.filename,
      options.sceneRecord.properties,
      options.log === false ? null : options.log || console.log,
    );
  }

  util.log(options, '时段数：' + groups.length + '；并发：' +
    Math.min(concurrency, groups.length));
  await runConcurrent(groups, concurrency, function (group, index) {
    return options.exportImage
      ? options.exportImage(group, index + 1, groups.length, options)
      : export_img(col, group, index + 1, groups.length, options);
  });
  util.log(options, '下载完成：' + options.outdir);
}

function export_col(col, options) {
  var host = globalThis._host;
  if (typeof globalThis.print === 'function') {
    globalThis.print('原始影像数：', col.size());
  }

  var promise = exportCollection(col, options);
  if (!host) return promise;

  var registered = promise.catch(function (error) {
    console.error('下载失败：', error.message || error);
    process.exitCode = 1;
    throw error;
  });
  host.pendingPrints.push(registered);
  return registered;
}

module.exports = {
  export_img,
  export_col,
  listGroups,
};

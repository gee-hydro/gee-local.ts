var fs = require('node:fs');
var path = require('node:path');
var util = require('./utilize.js');

function export_taskInfo(images, filename, properties, log) {
  var ee = globalThis.ee;
  if (!ee || !ee.Reducer) {
    throw new Error('影像记录仅在 gee-helper 本地运行时可用');
  }
  if (!filename) throw new Error('sceneRecord.filename 不能为空');
  if (!Array.isArray(properties) || properties.length < 1) {
    throw new Error('sceneRecord.properties 须为非空数组');
  }

  var rows = images.reduceColumns(
    ee.Reducer.toList(properties.length),
    properties,
  ).get('list');

  return util.evaluate(rows).then(function (values) {
    var timeIndex = properties.indexOf('system:time_start');
    var header = properties.slice();
    if (timeIndex >= 0) header[timeIndex] = 'datetime_utc';
    var lines = [header.map(util.csvCell).join(',')];
    values.forEach(function (row) {
      var cells = row.slice();
      if (timeIndex >= 0 && cells[timeIndex] != null) {
        cells[timeIndex] = new Date(Number(cells[timeIndex])).toISOString();
      }
      lines.push(cells.map(util.csvCell).join(','));
    });
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, lines.join('\n') + '\n');
    if (log) log('影像记录：' + filename);
  });
}

module.exports = {
  export_taskInfo,
};

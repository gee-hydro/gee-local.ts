var fs = require('node:fs');

function mkpath(dirname) {
  fs.mkdirSync(dirname, { recursive: true });
}

function evaluate(object) {
  return new Promise(function (resolve, reject) {
    object.evaluate(function (value, error) {
      if (error) reject(new Error(String(error)));
      else resolve(value);
    });
  });
}

function csvCell(value) {
  var text = value == null ? '' : String(value);
  return /[",\n\r]/.test(text)
    ? '"' + text.replace(/"/g, '""') + '"'
    : text;
}

function log(options, message) {
  if (options.log === false) return;
  (options.log || console.log)(message);
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function parsePeriod(period) {
  var match = /^(\d+)([dmy])$/i.exec(String(period || '1d'));
  var count = match ? Number(match[1]) : 0;
  if (!match || !Number.isInteger(count) || count < 1) {
    throw new Error('period 须为 Nd、Nm 或 Ny，例如 8d、1m、1y');
  }
  return { count: count, unit: match[2].toLowerCase() };
}

function groupKey(timestamp, period) {
  var date = new Date(Number(timestamp));
  if (!Number.isFinite(date.getTime())) {
    throw new Error('无效的 system:time_start：' + timestamp);
  }

  var year = date.getUTCFullYear();
  var month = date.getUTCMonth();
  var suffix = period.count === 1 ? '' : '_' + period.count + period.unit;

  if (period.unit === 'd') {
    var dayMs = 24 * 60 * 60 * 1000;
    var yearStart = Date.UTC(year, 0, 1);
    var day = Date.UTC(year, month, date.getUTCDate());
    var offset = Math.floor((day - yearStart) / dayMs / period.count)
      * period.count;
    var start = new Date(yearStart + offset * dayMs);
    return String(start.getUTCFullYear()) +
      pad2(start.getUTCMonth() + 1) +
      pad2(start.getUTCDate()) + suffix;
  }

  if (period.unit === 'm') {
    var absoluteMonth = year * 12 + month;
    var startMonth = Math.floor(absoluteMonth / period.count) * period.count;
    return String(Math.floor(startMonth / 12)) +
      pad2(startMonth % 12 + 1) + suffix;
  }
  return String(Math.floor(year / period.count) * period.count) + suffix;
}

function split_group(indices, timestamps, period, prefix, suffixPattern) {
  if (indices.length !== timestamps.length) {
    throw new Error('system:index 与 system:time_start 数量不一致');
  }

  var groups = {};
  var keys = [];
  indices.forEach(function (index, i) {
    var key = groupKey(timestamps[i], period);
    var match = suffixPattern && String(index).match(suffixPattern);
    if (match) {
      var suffix = String(match[1] == null ? match[0] : match[1])
        .replace(/[^A-Za-z0-9._-]+/g, '_');
      key += '_' + suffix;
    }
    if (!groups[key]) {
      groups[key] = [];
      keys.push(key);
    }
    groups[key].push(index);
  });
  return keys.map(function (key) {
    return {
      key: key,
      name: String(prefix || '') + key,
      indices: groups[key],
    };
  });
}

module.exports = {
  csvCell,
  mkpath,
  evaluate,
  groupKey,
  log,
  pad2,
  parsePeriod,
  split_group,
};

var fs = require('node:fs');
var path = require('node:path');

function parseCsvLine(line) {
  var cells = [];
  var cell = '';
  var quoted = false;
  for (var i = 0; i < line.length; i += 1) {
    var char = line[i];
    if (char === '"') {
      if (quoted && line[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

function read_csv(filename) {
  if (!fs.existsSync(filename)) return [];
  var text = fs.readFileSync(filename, 'utf8').trim();
  if (!text) return [];
  var lines = text.split(/\r?\n/);
  var header = parseCsvLine(lines.shift());
  return lines.map(function (line) {
    var cells = parseCsvLine(line);
    return header.reduce(function (record, name, i) {
      record[name] = cells[i] == null ? '' : cells[i];
      return record;
    }, {});
  });
}

function csv_text(records, columns, include_header) {
  var rows = Array.isArray(records) ? records : Array.from(records.values());
  var header = columns || Object.keys(rows[0] || {});
  var lines = rows.map(function (record) {
    return header.map(function (name) {
      var value = record[name];
      var text = value == null ? '' : String(value);
      return /[",\n\r]/.test(text)
        ? '"' + text.replace(/"/g, '""') + '"'
        : text;
    }).join(',');
  });
  if (include_header) lines.unshift(header.join(','));
  return lines.join('\n') + '\n';
}

function write_csv(filename, records, columns) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  var tmp = filename + '.tmp';
  fs.writeFileSync(tmp, csv_text(records, columns, true));
  fs.renameSync(tmp, filename);
}

function append_csv(filename, records, columns) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  var exists = fs.existsSync(filename) && fs.statSync(filename).size > 0;
  fs.appendFileSync(filename, csv_text(records, columns, !exists));
}

module.exports = {
  append_csv,
  read_csv,
  write_csv,
};

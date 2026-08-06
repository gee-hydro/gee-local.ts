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

function write_csv(filename, records, columns) {
  var rows = Array.isArray(records) ? records : Array.from(records.values());
  var header = columns || Object.keys(rows[0] || {});
  var lines = [header.join(',')];
  rows.forEach(function (record) {
    lines.push(header.map(function (name) {
      var value = record[name];
      var text = value == null ? '' : String(value);
      return /[",\n\r]/.test(text)
        ? '"' + text.replace(/"/g, '""') + '"'
        : text;
    }).join(','));
  });

  fs.mkdirSync(path.dirname(filename), { recursive: true });
  var tmp = filename + '.tmp';
  fs.writeFileSync(tmp, lines.join('\n') + '\n');
  fs.renameSync(tmp, filename);
}

module.exports = {
  read_csv,
  write_csv,
};

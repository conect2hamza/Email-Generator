/*
 * CSV parsing and serialisation (RFC 4180, with a few lenient extensions).
 * Everything runs locally; nothing here touches the network or the DOM.
 */
(function (ROG) {
  'use strict';

  var INVALID_MESSAGE =
    "We couldn't read this CSV file. Please check that it contains a header row and valid CSV data.";
  var EMPTY_MESSAGE = 'This CSV file contains no records.';

  function CsvError(message) {
    this.name = 'CsvError';
    this.message = message;
  }
  CsvError.prototype = Object.create(Error.prototype);

  /** Guess the delimiter from the first line (comma, semicolon or tab). */
  function detectDelimiter(text) {
    var counts = { ',': 0, ';': 0, '\t': 0 };
    var inQuotes = false;
    var limit = Math.min(text.length, 65536);
    for (var i = 0; i < limit; i++) {
      var c = text[i];
      if (c === '"') inQuotes = !inQuotes;
      else if (!inQuotes && (c === '\n' || c === '\r')) break;
      else if (!inQuotes && counts[c] !== undefined) counts[c]++;
    }
    var best = ',';
    if (counts[';'] > counts[best]) best = ';';
    if (counts['\t'] > counts[best]) best = '\t';
    return best;
  }

  /** Split CSV text into an array of rows (arrays of strings). */
  function tokenize(text, delimiter) {
    var rows = [];
    var row = [];
    var field = '';
    var inQuotes = false;
    var wasQuoted = false;
    var i = 0;
    var n = text.length;

    while (i < n) {
      var c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }

      if (c === '"' && field === '' && !wasQuoted) {
        inQuotes = true;
        wasQuoted = true;
        i++;
        continue;
      }
      if (c === delimiter) {
        row.push(field);
        field = '';
        wasQuoted = false;
        i++;
        continue;
      }
      if (c === '\n' || c === '\r') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        wasQuoted = false;
        i += c === '\r' && text[i + 1] === '\n' ? 2 : 1;
        continue;
      }
      field += c;
      i++;
    }

    if (inQuotes) {
      throw new CsvError(INVALID_MESSAGE);
    }
    if (field !== '' || wasQuoted || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function isBlankRow(row) {
    for (var i = 0; i < row.length; i++) {
      if (row[i].trim() !== '') return false;
    }
    return true;
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  /**
   * Parse and validate CSV text.
   * Returns { headers, rows, delimiter, warnings } or throws CsvError.
   */
  function parse(text) {
    if (typeof text !== 'string') throw new CsvError(INVALID_MESSAGE);
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.indexOf('\u0000') !== -1) throw new CsvError(INVALID_MESSAGE);
    if (text.trim() === '') throw new CsvError(EMPTY_MESSAGE);

    var delimiter = detectDelimiter(text);
    var all = tokenize(text, delimiter);
    var warnings = [];

    // Skip blank lines before the header row.
    var start = 0;
    while (start < all.length && isBlankRow(all[start])) start++;
    if (start >= all.length) throw new CsvError(EMPTY_MESSAGE);

    var rawHeaders = all[start].map(function (h) {
      return h.trim();
    });
    // Drop trailing header cells that are empty (common with trailing commas).
    var headerCount = rawHeaders.length;
    while (headerCount > 0 && rawHeaders[headerCount - 1] === '') headerCount--;
    if (headerCount === 0) throw new CsvError(INVALID_MESSAGE);
    rawHeaders = rawHeaders.slice(0, headerCount);

    var body = all.slice(start + 1);
    var rows = [];
    var skippedEmpty = 0;
    var padded = 0;
    var widest = headerCount;

    for (var r = 0; r < body.length; r++) {
      var row = body[r];
      if (isBlankRow(row)) {
        skippedEmpty++;
        continue;
      }
      // Trim trailing empty cells beyond the header width.
      var len = row.length;
      while (len > headerCount && row[len - 1].trim() === '') len--;
      if (len !== row.length) row = row.slice(0, len);
      if (row.length < headerCount) padded++;
      if (row.length > widest) widest = row.length;
      rows.push(row);
    }

    if (rows.length === 0) throw new CsvError(EMPTY_MESSAGE);

    // Name unnamed columns and any extra columns found in data rows.
    var headers = [];
    var unnamed = 0;
    for (var h = 0; h < widest; h++) {
      var name = h < headerCount ? rawHeaders[h] : '';
      if (name === '') {
        unnamed++;
        name = 'Column ' + (h + 1);
      }
      headers.push(name);
    }
    for (var p = 0; p < rows.length; p++) {
      while (rows[p].length < widest) rows[p].push('');
    }

    if (delimiter !== ',') {
      warnings.push(
        'Detected ' + (delimiter === ';' ? 'semicolon' : 'tab') + '-separated values.'
      );
    }
    if (skippedEmpty > 0) {
      warnings.push('Skipped ' + plural(skippedEmpty, 'completely empty row.', 'completely empty rows.'));
    }
    if (widest > headerCount) {
      warnings.push(
        'Some rows had more values than the header row; extra values were kept as ' +
          plural(widest - headerCount, 'extra column.', 'extra columns.')
      );
    } else if (unnamed > 0) {
      warnings.push('Columns without a header name (' + unnamed + ') were named "Column N".');
    }
    if (padded > 0) {
      warnings.push('Rows with fewer values than the header row (' + padded + '): missing cells are treated as empty.');
    }

    var seen = {};
    var dupes = [];
    headers.forEach(function (name) {
      var key = name.toLowerCase();
      seen[key] = (seen[key] || 0) + 1;
      if (seen[key] === 2) dupes.push(name);
    });
    if (dupes.length) {
      warnings.push('Duplicate column names: ' + dupes.join(', ') + '. Both columns are kept.');
    }

    return { headers: headers, rows: rows, delimiter: delimiter, warnings: warnings };
  }

  function escapeField(value) {
    var s = value == null ? '' : String(value);
    if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /** Serialise an array of rows (first row = headers) to CSV text with CRLF line endings. */
  function stringify(rows) {
    return rows
      .map(function (row) {
        return row.map(escapeField).join(',');
      })
      .join('\r\n') + '\r\n';
  }

  ROG.csv = {
    parse: parse,
    stringify: stringify,
    CsvError: CsvError,
    INVALID_MESSAGE: INVALID_MESSAGE,
    EMPTY_MESSAGE: EMPTY_MESSAGE
  };
})((window.ROG = window.ROG || {}));

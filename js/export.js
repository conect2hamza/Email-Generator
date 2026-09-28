/*
 * CSV export: original columns are preserved, generated columns are appended
 * (or updated in place when re-exporting a previously exported file).
 */
(function (ROG) {
  'use strict';

  function pad(n) {
    return n < 10 ? '0' + n : String(n);
  }

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /**
   * data: { headers, rows, columns: { subject, message, status, statusHeader } }
   * generate(rowIndex) -> { subject, body }
   * statuses: array of status strings indexed like data.rows
   */
  function buildRows(data, indices, generate, statuses) {
    var headers = data.headers.slice();
    var cols = data.columns;

    function ensure(col, name) {
      if (col >= 0) return col;
      headers.push(name);
      return headers.length - 1;
    }
    var subjectCol = ensure(cols.subject, 'Generated Subject');
    var messageCol = ensure(cols.message, 'Generated Message');
    var statusCol = ensure(cols.status, cols.statusHeader);

    var out = [headers];
    indices.forEach(function (i) {
      var row = data.rows[i].slice();
      while (row.length < headers.length) row.push('');
      var g = generate(i);
      row[subjectCol] = g.subject;
      row[messageCol] = g.body;
      row[statusCol] = statuses[i];
      out.push(row);
    });
    return out;
  }

  function download(filename, text) {
    // The BOM lets Excel detect UTF-8 so accented names survive the round trip.
    var blob = new Blob(['﻿' + text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function exportRecords(kind, data, indices, generate, statuses) {
    var rows = buildRows(data, indices, generate, statuses);
    var name = 'review-outreach-' + (kind === 'current' ? 'current' : 'generated') + '-' + today() + '.csv';
    download(name, ROG.csv.stringify(rows));
    return name;
  }

  function downloadTemplate() {
    var name = 'review-outreach-template.csv';
    download(name, ROG.csv.stringify(ROG.template.csvTemplateRows()));
    return name;
  }

  ROG.exporter = {
    buildRows: buildRows,
    exportRecords: exportRecords,
    downloadTemplate: downloadTemplate
  };
})((window.ROG = window.ROG || {}));

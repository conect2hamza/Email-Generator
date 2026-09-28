/*
 * Application state and wiring.
 */
(function (ROG) {
  'use strict';

  var T = ROG.template;
  var S = ROG.storage;
  var ui = ROG.ui;
  var $ = ui.$;
  var el = ui.el;

  var STATUSES = ['Pending', 'Ready', 'Sent'];
  var STATUS_CODES = { Pending: 'P', Ready: 'R', Sent: 'S' };
  var CODE_STATUSES = { P: 'Pending', R: 'Ready', S: 'Sent' };
  var MAX_FILE_BYTES = 50 * 1024 * 1024;
  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  var state = {
    data: null,          // { fileName, headers, rows, sig, headerSig, warnings, columns, search }
    mapping: {},         // standard variable name -> column index (-1 = unmapped)
    customVars: [],      // [{ name, label, col }]
    customByName: {},
    statuses: [],        // per row: 'Pending' | 'Ready' | 'Sent'
    view: [],            // row indexes after search + sort
    current: -1,         // row index of the selected record
    query: '',
    sort: { key: 'index', dir: 1 },
    sender: { name: '', company: '', phone: '', email: '', website: '' },
    fallback: '',
    templates: [],
    editor: { templateId: null, subject: '', body: '' },
    lastField: null,     // last focused template field, for variable insertion
    previewMode: 'email'
  };

  /* ------------------------------------------------------------------ */
  /* Persistence                                                         */
  /* ------------------------------------------------------------------ */

  function debounce(fn, wait) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, wait);
    };
  }

  var saveEditor = debounce(function () {
    S.set('editor', state.editor);
  }, 250);

  var saveStatuses = debounce(function () {
    if (!state.data) return;
    var codes = state.statuses.map(function (s) { return STATUS_CODES[s] || 'P'; }).join('');
    S.setKeyed('statuses', state.data.sig, codes, 20);
  }, 250);

  function savePrefs() {
    S.set('prefs', { previewMode: state.previewMode, sort: state.sort });
  }

  function loadPersisted() {
    var sender = S.get('sender', null);
    if (sender && typeof sender === 'object') {
      Object.keys(state.sender).forEach(function (k) {
        if (typeof sender[k] === 'string') state.sender[k] = sender[k];
      });
    }
    var fallback = S.get('fallback', '');
    state.fallback = typeof fallback === 'string' ? fallback : '';

    var templates = S.get('templates', null);
    if (Array.isArray(templates)) {
      state.templates = templates.filter(function (t) {
        return t && typeof t.id === 'string' && typeof t.name === 'string';
      });
    } else {
      state.templates = [copyTemplate(T.DEFAULT_TEMPLATE)];
      S.set('templates', state.templates);
    }

    var editor = S.get('editor', null);
    if (editor && typeof editor.subject === 'string' && typeof editor.body === 'string') {
      state.editor = {
        templateId: findTemplate(editor.templateId) ? editor.templateId : null,
        subject: editor.subject,
        body: editor.body
      };
    } else {
      var first = state.templates[0] || T.DEFAULT_TEMPLATE;
      state.editor = { templateId: state.templates[0] ? first.id : null, subject: first.subject, body: first.body };
    }

    var prefs = S.get('prefs', {});
    if (prefs && (prefs.previewMode === 'email' || prefs.previewMode === 'plain')) state.previewMode = prefs.previewMode;
    if (prefs && prefs.sort && ['index', 'business', 'reviews', 'status'].indexOf(prefs.sort.key) !== -1) {
      state.sort = { key: prefs.sort.key, dir: prefs.sort.dir === -1 ? -1 : 1 };
    }
  }

  function copyTemplate(t) {
    return { id: t.id, name: t.name, subject: t.subject, body: t.body };
  }

  function findTemplate(id) {
    for (var i = 0; i < state.templates.length; i++) {
      if (state.templates[i].id === id) return state.templates[i];
    }
    return null;
  }

  function saveTemplates() {
    S.set('templates', state.templates);
  }

  /* ------------------------------------------------------------------ */
  /* CSV loading                                                         */
  /* ------------------------------------------------------------------ */

  function isCsvFile(file) {
    var name = (file.name || '').toLowerCase();
    var type = (file.type || '').toLowerCase();
    if (/\.csv$/.test(name)) return true;
    return type === 'text/csv' || type === 'application/csv';
  }

  function readFileText(file) {
    return file.arrayBuffer().then(function (buffer) {
      try {
        return { text: new TextDecoder('utf-8', { fatal: true }).decode(buffer), encoding: 'utf-8' };
      } catch (e) {
        // Excel on Windows often saves CSV as Windows-1252.
        return { text: new TextDecoder('windows-1252').decode(buffer), encoding: 'windows-1252' };
      }
    });
  }

  function showLoadError(message) {
    var box = $('loadError');
    box.textContent = message;
    box.hidden = false;
  }

  function handleFile(file) {
    $('loadError').hidden = true;
    if (!file) return;
    if (!isCsvFile(file)) {
      showLoadError('Please choose a CSV file (.csv). Other file types are not supported.');
      return;
    }
    if (file.size === 0) {
      showLoadError(ROG.csv.EMPTY_MESSAGE);
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      showLoadError('This file is too large. Please use a CSV smaller than 50 MB.');
      return;
    }
    readFileText(file)
      .then(function (result) {
        var parsed = ROG.csv.parse(result.text);
        if (result.encoding !== 'utf-8') {
          parsed.warnings.push('File was not UTF-8; it was read as Windows-1252 text.');
        }
        loadData(file.name, parsed);
      })
      .catch(function (err) {
        showLoadError(err && err.name === 'CsvError' ? err.message : ROG.csv.INVALID_MESSAGE);
      });
  }

  function detectColumns(headers, rows) {
    var norm = headers.map(function (h) { return h.toLowerCase().replace(/[^a-z0-9]/g, ''); });
    function find(names) {
      for (var i = 0; i < norm.length; i++) if (names.indexOf(norm[i]) !== -1) return i;
      return -1;
    }
    var status = -1;
    var statusHeader = 'Status';
    var candidate = find(['status', 'outreachstatus']);
    if (candidate !== -1) {
      var ours = rows.every(function (r) {
        var v = (r[candidate] || '').trim().toLowerCase();
        return v === '' || v === 'pending' || v === 'ready' || v === 'sent';
      });
      if (ours) status = candidate;
      else statusHeader = 'Outreach Status';
    }
    return {
      subject: find(['generatedsubject']),
      message: find(['generatedmessage']),
      status: status,
      statusHeader: statusHeader
    };
  }

  function loadData(fileName, parsed) {
    var headers = parsed.headers;
    var rows = parsed.rows;
    var headerSig = S.hash(headers.join('\u0001'));
    var sig = S.hash(
      headers.join('\u0001') + '\u0002' + rows.length + '\u0002' +
      rows[0].join('\u0001') + '\u0002' + rows[rows.length - 1].join('\u0001')
    );
    var columns = detectColumns(headers, rows);

    state.data = {
      fileName: fileName,
      headers: headers,
      rows: rows,
      sig: sig,
      headerSig: headerSig,
      warnings: parsed.warnings,
      columns: columns,
      search: rows.map(function (r) { return r.join(' \u0001 ').toLowerCase(); })
    };

    // Statuses: from a Status column (re-imported export), then any saved edits.
    state.statuses = rows.map(function (r) {
      if (columns.status < 0) return 'Pending';
      var v = (r[columns.status] || '').trim().toLowerCase();
      return v === 'ready' ? 'Ready' : v === 'sent' ? 'Sent' : 'Pending';
    });
    var saved = S.getKeyed('statuses', sig, null);
    if (typeof saved === 'string' && saved.length === rows.length) {
      for (var i = 0; i < saved.length; i++) state.statuses[i] = CODE_STATUSES[saved[i]] || 'Pending';
    }

    // Mapping: remembered mapping for this exact header set, else auto-detect.
    var auto = T.autoMap(headers);
    var remembered = S.getKeyed('mapping', headerSig, null);
    state.mapping = auto;
    if (remembered && typeof remembered === 'object') {
      Object.keys(auto).forEach(function (k) {
        var v = remembered[k];
        if (typeof v === 'number' && v >= -1 && v < headers.length) state.mapping[k] = v;
      });
    }
    refreshCustomVars();

    state.query = '';
    $('search').value = '';
    computeView();
    state.current = state.view.length ? state.view[0] : 0;

    renderRecordsPanel();
    renderTable();
    renderVariableButtons();
    selectRecord(state.current, { scroll: true });
    ui.announce(rows.length + ' records loaded');

    var mappedCount = countMapped();
    if (mappedCount === 0 || state.mapping.business_name < 0) openDialog('csvDialog');
  }

  function refreshCustomVars() {
    if (!state.data) {
      state.customVars = [];
      state.customByName = {};
      return;
    }
    // Generated/status columns from a previous export are outputs, not inputs.
    var cols = state.data.columns;
    var skip = {};
    [cols.subject, cols.message, cols.status].forEach(function (c) { if (c >= 0) skip[c] = true; });
    state.customVars = T.customVariables(state.data.headers, state.mapping).filter(function (v) {
      return !skip[v.col];
    });
    state.customByName = {};
    state.customVars.forEach(function (v) { state.customByName[v.name] = v; });
  }

  function countMapped() {
    return T.PROSPECT_VARS.filter(function (v) { return state.mapping[v.name] >= 0; }).length;
  }

  /* ------------------------------------------------------------------ */
  /* Generation                                                          */
  /* ------------------------------------------------------------------ */

  function cell(rowIndex, col) {
    if (!state.data || col == null || col < 0) return '';
    var row = state.data.rows[rowIndex];
    return row ? T.cleanValue(row[col]) : '';
  }

  function resolverFor(rowIndex) {
    return function (name) {
      if (T.PROSPECT_BY_NAME[name]) {
        var col = state.mapping[name];
        if (col == null || col < 0) return { known: true, value: '', reason: 'unmapped' };
        var value = cell(rowIndex, col);
        return { known: true, value: value, reason: value ? null : 'empty' };
      }
      var sender = T.SENDER_BY_NAME[name];
      if (sender) {
        var sv = T.cleanValue(state.sender[sender.key]);
        return { known: true, value: sv, reason: sv ? null : 'sender' };
      }
      var custom = state.customByName[name];
      if (custom) {
        var cv = cell(rowIndex, custom.col);
        return { known: true, value: cv, reason: cv ? null : 'empty' };
      }
      return { known: false };
    };
  }

  function generate(rowIndex) {
    var resolve = resolverFor(rowIndex);
    var subject = T.render(state.editor.subject, resolve, state.fallback);
    var body = T.render(state.editor.body, resolve, state.fallback);
    return {
      subject: subject.text.replace(/\s*[\r\n]+\s*/g, ' ').trim(),
      body: body.text,
      subjectSegments: subject.segments,
      bodySegments: body.segments,
      to: cell(rowIndex, state.mapping.email)
    };
  }

  function fullEmail(g) {
    return 'Subject: ' + g.subject + '\n\n' + g.body;
  }

  /* ------------------------------------------------------------------ */
  /* Records panel                                                       */
  /* ------------------------------------------------------------------ */

  function renderRecordsPanel() {
    var loaded = !!state.data;
    $('dropzone').hidden = loaded;
    $('recordsLoaded').hidden = !loaded;
    if (!loaded) {
      $('recordCount').textContent = '';
      return;
    }
    var n = state.data.rows.length;
    $('loadedText').textContent = n.toLocaleString() + (n === 1 ? ' record loaded' : ' records loaded');
    $('fileName').textContent = state.data.fileName;
    $('fileName').title = state.data.fileName;

    var list = $('loadWarnings');
    ui.clear(list);
    state.data.warnings.forEach(function (w) { list.appendChild(el('li', null, w)); });
    list.hidden = state.data.warnings.length === 0;

    renderMappingSummary();
  }

  function renderMappingSummary() {
    var p = $('mappingSummary');
    ui.clear(p);
    if (!state.data) return;
    var mapped = countMapped();
    var total = T.PROSPECT_VARS.length;
    var weak = state.mapping.business_name < 0;
    p.className = 'small mapping-summary' + (weak ? ' is-warning' : '');
    p.appendChild(document.createTextNode(
      (weak ? 'Business name is not mapped. ' : '') + mapped + ' of ' + total + ' fields mapped · '
    ));
    p.appendChild(el('button', { type: 'button', class: 'link-btn', 'data-open': 'csvDialog' }, 'Edit mapping'));
  }

  function businessName(i) {
    return cell(i, state.mapping.business_name);
  }

  function reviewsNumber(i) {
    var v = cell(i, state.mapping.total_reviews).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(v);
    return isNaN(n) ? null : n;
  }

  function computeView() {
    if (!state.data) {
      state.view = [];
      return;
    }
    var q = state.query.trim().toLowerCase();
    var terms = q ? q.split(/\s+/) : [];
    var view = [];
    var search = state.data.search;
    for (var i = 0; i < search.length; i++) {
      var ok = true;
      for (var t = 0; t < terms.length; t++) {
        if (search[i].indexOf(terms[t]) === -1) { ok = false; break; }
      }
      if (ok) view.push(i);
    }

    var key = state.sort.key;
    var dir = state.sort.dir;
    if (key === 'business') {
      var names = {};
      view.forEach(function (i) { names[i] = businessName(i); });
      view.sort(function (a, b) {
        if (!names[a] !== !names[b]) return names[a] ? -1 : 1; // blanks last
        return (collator.compare(names[a], names[b]) || a - b) * dir;
      });
    } else if (key === 'reviews') {
      var nums = {};
      view.forEach(function (i) { nums[i] = reviewsNumber(i); });
      view.sort(function (a, b) {
        if ((nums[a] === null) !== (nums[b] === null)) return nums[a] === null ? 1 : -1;
        return ((nums[a] - nums[b]) || a - b) * dir;
      });
    } else if (key === 'status') {
      view.sort(function (a, b) {
        var d = STATUSES.indexOf(state.statuses[a]) - STATUSES.indexOf(state.statuses[b]);
        return (d || a - b) * dir;
      });
    } else if (dir === -1) {
      view.reverse();
    }
    state.view = view;
  }

  function statusBadge(status) {
    return el('span', { class: 'badge badge-' + status.toLowerCase() }, status);
  }

  function buildRow(i) {
    var name = businessName(i);
    var email = cell(i, state.mapping.email);
    var reviews = cell(i, state.mapping.total_reviews);
    var last = cell(i, state.mapping.last_review);

    var nameBtn = el('button', { type: 'button', class: 'row-btn' + (name ? '' : ' is-empty') }, name || '(no business name)');
    var bizCell = el('td', { class: 'c-biz' }, nameBtn);
    if (email) bizCell.appendChild(el('div', { class: 'sub' }, email));

    var revCell = el('td', { class: 'c-rev' }, reviews || el('span', { class: 'muted' }, '—'));
    if (last) revCell.appendChild(el('div', { class: 'sub' }, last));

    var tr = el('tr', { 'data-i': String(i) },
      el('td', { class: 'c-num' }, String(i + 1)),
      bizCell,
      revCell,
      el('td', { class: 'c-status' }, statusBadge(state.statuses[i]))
    );
    if (i === state.current) {
      tr.className = 'is-current';
      tr.setAttribute('aria-current', 'true');
    }
    return tr;
  }

  // Rows are rendered in chunks so large files stay responsive; more rows are
  // appended as the list is scrolled or when navigation reaches them.
  var ROW_CHUNK = 200;
  var rendered = 0;
  var moreObserver = null;

  function renderRowsUntil(limit) {
    limit = Math.min(limit, state.view.length);
    if (limit <= rendered) return;
    var tbody = $('recordsBody');
    var old = tbody.querySelector('.more-row');
    if (old) old.remove();

    var frag = document.createDocumentFragment();
    for (var p = rendered; p < limit; p++) frag.appendChild(buildRow(state.view[p]));
    rendered = limit;

    var remaining = state.view.length - rendered;
    if (remaining > 0) {
      var more = el('tr', { class: 'more-row' },
        el('td', { colspan: '4' },
          el('button', { type: 'button', class: 'link-btn', 'data-more': '' },
            'Show more (' + remaining.toLocaleString() + ' remaining)')));
      frag.appendChild(more);
      if (moreObserver) moreObserver.observe(more);
    }
    tbody.appendChild(frag);
  }

  function renderMore() {
    renderRowsUntil(rendered + ROW_CHUNK);
  }

  function renderTable() {
    var tbody = $('recordsBody');
    if (moreObserver) moreObserver.disconnect();
    tbody.textContent = '';
    rendered = 0;
    if (!state.data) return;

    var pos = state.view.indexOf(state.current);
    renderRowsUntil(Math.max(ROW_CHUNK, pos + 1 + ROW_CHUNK / 4));

    $('noResults').hidden = state.view.length > 0;
    var total = state.data.rows.length;
    $('recordCount').textContent = state.view.length === total
      ? total.toLocaleString() + ' total'
      : state.view.length.toLocaleString() + ' of ' + total.toLocaleString();
    renderSortIndicators();
  }

  function renderSortIndicators() {
    var ths = document.querySelectorAll('[data-sort-col]');
    Array.prototype.forEach.call(ths, function (th) {
      var key = th.getAttribute('data-sort-col');
      if (key === state.sort.key) th.setAttribute('aria-sort', state.sort.dir === 1 ? 'ascending' : 'descending');
      else th.removeAttribute('aria-sort');
    });
  }

  function rowElement(i) {
    return $('recordsBody').querySelector('tr[data-i="' + i + '"]');
  }

  function updateRowStatus(i) {
    var tr = rowElement(i);
    if (!tr) return;
    var td = tr.querySelector('.c-status');
    ui.clear(td);
    td.appendChild(statusBadge(state.statuses[i]));
  }

  /* ------------------------------------------------------------------ */
  /* Selection & navigation                                              */
  /* ------------------------------------------------------------------ */

  function selectRecord(i, opts) {
    if (!state.data) return;
    var prev = rowElement(state.current);
    if (prev) {
      prev.classList.remove('is-current');
      prev.removeAttribute('aria-current');
    }
    state.current = i;
    var pos = state.view.indexOf(i);
    if (pos >= rendered) renderRowsUntil(pos + 1 + ROW_CHUNK / 4);
    var tr = rowElement(i);
    if (tr) {
      tr.classList.add('is-current');
      tr.setAttribute('aria-current', 'true');
      if (opts && opts.scroll) scrollRowIntoView(tr);
    }
    renderPreview();
    renderActionBar();
  }

  function scrollRowIntoView(tr) {
    var wrap = $('tableWrap');
    var head = wrap.querySelector('thead');
    var headH = head ? head.offsetHeight : 0;
    var top = tr.offsetTop;
    var bottom = top + tr.offsetHeight;
    if (top - headH < wrap.scrollTop) wrap.scrollTop = top - headH;
    else if (bottom > wrap.scrollTop + wrap.clientHeight) wrap.scrollTop = bottom - wrap.clientHeight;
  }

  function step(delta) {
    if (!state.data || !state.view.length) return;
    var pos = state.view.indexOf(state.current);
    var next = pos === -1 ? 0 : pos + delta;
    if (next < 0 || next >= state.view.length) return;
    selectRecord(state.view[next], { scroll: true });
  }

  function renderActionBar() {
    var has = !!state.data;
    var pos = has ? state.view.indexOf(state.current) : -1;
    var total = has ? state.data.rows.length : 0;
    var filtered = has && state.view.length !== total;

    $('prevBtn').disabled = !has || pos <= 0;
    $('nextBtn').disabled = !has || pos === -1 || pos >= state.view.length - 1;

    if (has) {
      var name = businessName(state.current) || 'Record ' + (state.current + 1);
      $('currentName').textContent = name;
      $('currentName').title = name;
      $('currentPos').textContent = pos === -1
        ? 'Record ' + (state.current + 1) + ' (hidden by search)'
        : (pos + 1).toLocaleString() + ' of ' + state.view.length.toLocaleString() +
          (filtered ? ' (filtered from ' + total.toLocaleString() + ')' : '');
      $('statusSelect').value = state.statuses[state.current];
    } else {
      $('currentName').textContent = 'No record selected';
      $('currentName').title = '';
      $('currentPos').textContent = '0 of 0';
    }

    Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (b) { b.disabled = !has; });
    $('statusSelect').disabled = !has;
    $('exportCurrentBtn').disabled = !has;
    $('exportAllBtn').disabled = !has;
  }

  /* ------------------------------------------------------------------ */
  /* Preview                                                             */
  /* ------------------------------------------------------------------ */

  function appendSegments(container, segments) {
    segments.forEach(function (seg) {
      if (seg.type === 'text') {
        container.appendChild(document.createTextNode(seg.value));
      } else if (!seg.known) {
        container.appendChild(el('mark', { class: 'var-unknown', title: 'Unknown variable' }, seg.raw));
      } else if (seg.value !== '') {
        container.appendChild(document.createTextNode(seg.value));
      } else if (state.fallback) {
        container.appendChild(el('span', { class: 'var-empty', title: seg.raw + ' is empty' }, state.fallback));
      }
    });
  }

  function templateVariables() {
    var seen = {};
    var all = [];
    [state.editor.subject, state.editor.body].forEach(function (tpl) {
      T.render(tpl, function () { return { known: false }; }).segments.forEach(function (s) {
        if (s.type === 'var' && !seen[s.name]) {
          seen[s.name] = true;
          all.push(s.name);
        }
      });
    });
    return all;
  }

  function renderWarnings(g) {
    var box = $('previewWarnings');
    ui.clear(box);

    var names = templateVariables();
    var resolve = resolverFor(state.data ? state.current : -1);
    var unknown = [], unmapped = [], empty = [], sender = [];
    names.forEach(function (name) {
      var r = resolve(name);
      if (!r.known) unknown.push(name);
      else if (r.reason === 'unmapped' && state.data) unmapped.push(name);
      else if (r.reason === 'sender') sender.push(name);
      else if (r.reason === 'empty' && g) empty.push(name);
    });

    function tokens(list) {
      var span = el('span', { class: 'var-tokens' });
      list.forEach(function (n) { span.appendChild(el('code', null, '{{' + n + '}}')); });
      return span;
    }

    if (unknown.length) {
      box.appendChild(el('div', { class: 'alert alert-warning', role: 'status' },
        el('strong', null, 'Unknown variable detected. '),
        (unknown.length === 1 ? 'This template contains an unknown variable: ' : 'This template contains unknown variables: '),
        tokens(unknown)));
    }
    if (unmapped.length) {
      box.appendChild(el('div', { class: 'alert alert-info' },
        'Not mapped to a CSV column: ', tokens(unmapped), ' ',
        el('button', { type: 'button', class: 'link-btn', 'data-open': 'csvDialog' }, 'Edit mapping')));
    }
    if (sender.length) {
      box.appendChild(el('div', { class: 'alert alert-info' },
        'Not set yet: ', tokens(sender), ' ',
        el('button', { type: 'button', class: 'link-btn', 'data-open': 'settingsDialog' }, 'Open Settings')));
    }
    if (empty.length) {
      box.appendChild(el('div', { class: 'alert alert-muted' },
        'Empty for this record: ', tokens(empty)));
    }
  }

  function renderPreview() {
    var has = !!state.data;
    $('previewEmpty').hidden = has;
    $('emailView').hidden = !has || state.previewMode !== 'email';
    $('plainView').hidden = !has || state.previewMode !== 'plain';

    if (!has) {
      renderWarnings(null);
      return;
    }
    var g = generate(state.current);
    renderWarnings(g);

    var to = $('pvTo');
    ui.clear(to);
    if (g.to) to.textContent = g.to;
    else to.appendChild(el('span', { class: 'muted' }, 'No email address'));

    var subj = $('pvSubject');
    ui.clear(subj);
    appendSegments(subj, g.subjectSegments.map(function (s) {
      return s.type === 'text' ? { type: 'text', value: s.value.replace(/\s*[\r\n]+\s*/g, ' ') } : s;
    }));

    var body = $('pvBody');
    ui.clear(body);
    appendSegments(body, g.bodySegments);

    $('plainText').value = fullEmail(g);
  }

  function setPreviewMode(mode) {
    state.previewMode = mode;
    Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });
    savePrefs();
    renderPreview();
  }

  /* ------------------------------------------------------------------ */
  /* Template editor                                                     */
  /* ------------------------------------------------------------------ */

  function isDirty() {
    var t = findTemplate(state.editor.templateId);
    return !t || t.subject !== state.editor.subject || t.body !== state.editor.body;
  }

  function renderDirty() {
    $('dirtyFlag').hidden = !isDirty();
  }

  function renderTemplateSelect() {
    var select = $('templateSelect');
    ui.clear(select);
    if (!findTemplate(state.editor.templateId)) {
      select.appendChild(el('option', { value: '' }, 'Unsaved template'));
    }
    state.templates.forEach(function (t) {
      select.appendChild(el('option', { value: t.id }, t.name));
    });
    select.value = state.editor.templateId || '';
    renderDirty();
  }

  function renderEditor() {
    $('subjectInput').value = state.editor.subject;
    $('bodyInput').value = state.editor.body;
    renderTemplateSelect();
  }

  function onEditorInput() {
    state.editor.subject = $('subjectInput').value;
    state.editor.body = $('bodyInput').value;
    saveEditor();
    renderDirty();
    renderPreview();
  }

  function confirmDiscard() {
    return !isDirty() || window.confirm('Discard your unsaved template changes?');
  }

  function loadTemplate(id) {
    var t = findTemplate(id);
    if (!t) return;
    state.editor = { templateId: t.id, subject: t.subject, body: t.body };
    S.set('editor', state.editor);
    renderEditor();
    renderPreview();
    renderTemplateList();
    ui.announce('Loaded template ' + t.name);
  }

  function nameTaken(name, exceptId) {
    var lower = name.toLowerCase();
    return state.templates.some(function (t) { return t.id !== exceptId && t.name.toLowerCase() === lower; });
  }

  function saveTemplate() {
    var t = findTemplate(state.editor.templateId);
    if (!t) return saveTemplateAs();
    t.subject = state.editor.subject;
    t.body = state.editor.body;
    saveTemplates();
    S.set('editor', state.editor);
    renderTemplateSelect();
    renderTemplateList();
    ui.flashButton($('saveTemplateBtn'), 'Saved!');
    ui.announce('Template saved');
  }

  function saveTemplateAs() {
    var current = findTemplate(state.editor.templateId);
    var suggestion = current ? current.name + ' copy' : '';
    return ui.askName('Save template as', suggestion, 'Save', function (name) {
      return nameTaken(name) ? 'A template with this name already exists.' : '';
    }).then(function (name) {
      if (!name) return;
      var t = {
        id: 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: name,
        subject: state.editor.subject,
        body: state.editor.body
      };
      state.templates.push(t);
      state.editor.templateId = t.id;
      saveTemplates();
      S.set('editor', state.editor);
      renderTemplateSelect();
      renderTemplateList();
      ui.announce('Template saved as ' + name);
    });
  }

  function renameTemplate(id) {
    var t = findTemplate(id);
    if (!t) return;
    ui.askName('Rename template', t.name, 'Rename', function (name) {
      return nameTaken(name, id) ? 'A template with this name already exists.' : '';
    }).then(function (name) {
      if (!name) return;
      t.name = name;
      saveTemplates();
      renderTemplateSelect();
      renderTemplateList();
    });
  }

  function deleteTemplate(id) {
    var t = findTemplate(id);
    if (!t) return;
    if (!window.confirm('Delete the template “' + t.name + '”? This cannot be undone.')) return;
    state.templates = state.templates.filter(function (x) { return x.id !== id; });
    if (state.editor.templateId === id) {
      // Keep the text in the editor; it simply becomes unsaved.
      state.editor.templateId = null;
      S.set('editor', state.editor);
    }
    saveTemplates();
    renderTemplateSelect();
    renderTemplateList();
  }

  function renderTemplateList() {
    var list = $('templateList');
    ui.clear(list);
    state.templates.forEach(function (t) {
      var isCurrent = t.id === state.editor.templateId;
      list.appendChild(el('li', { class: 'template-item' + (isCurrent ? ' is-current' : '') },
        el('div', { class: 'template-name' },
          el('span', null, t.name),
          isCurrent ? el('span', { class: 'badge badge-ready' }, 'In editor') : null),
        el('div', { class: 'template-actions' },
          el('button', { type: 'button', class: 'btn btn-small', 'data-tpl-action': 'load', 'data-id': t.id, 'aria-label': 'Load ' + t.name }, 'Load'),
          el('button', { type: 'button', class: 'btn btn-small', 'data-tpl-action': 'rename', 'data-id': t.id, 'aria-label': 'Rename ' + t.name }, 'Rename'),
          el('button', { type: 'button', class: 'btn btn-small btn-danger-text', 'data-tpl-action': 'delete', 'data-id': t.id, 'aria-label': 'Delete ' + t.name }, 'Delete'))
      ));
    });
    $('templateListEmpty').hidden = state.templates.length > 0;
    $('restoreDefaultBtn').hidden = !!findTemplate(T.DEFAULT_TEMPLATE.id);
  }

  function restoreDefault() {
    if (findTemplate(T.DEFAULT_TEMPLATE.id)) return;
    var t = copyTemplate(T.DEFAULT_TEMPLATE);
    if (nameTaken(t.name)) t.name = t.name + ' (default)';
    state.templates.unshift(t);
    saveTemplates();
    renderTemplateSelect();
    renderTemplateList();
  }

  /* ------------------------------------------------------------------ */
  /* Variable buttons                                                    */
  /* ------------------------------------------------------------------ */

  function renderVariableButtons() {
    var root = $('variableGroups');
    ui.clear(root);

    function group(title, items) {
      if (!items.length) return;
      var wrap = el('div', { class: 'var-group' }, el('p', { class: 'var-group-title small muted' }, title));
      var chips = el('div', { class: 'chips' });
      items.forEach(function (item) {
        chips.appendChild(el('button', {
          type: 'button',
          class: 'chip' + (item.dim ? ' is-dim' : ''),
          'data-var': item.name,
          title: '{{' + item.name + '}}' + (item.hint ? ' — ' + item.hint : '')
        }, item.label));
      });
      wrap.appendChild(chips);
      root.appendChild(wrap);
    }

    group('Prospect', T.PROSPECT_VARS.map(function (v) {
      var unmapped = !!state.data && !(state.mapping[v.name] >= 0);
      return { name: v.name, label: v.label, dim: unmapped, hint: unmapped ? 'not mapped to a CSV column' : '' };
    }));
    group('Sender', T.SENDER_VARS.map(function (v) {
      var empty = !T.cleanValue(state.sender[v.key]);
      return { name: v.name, label: v.label, dim: empty, hint: empty ? 'not set in Settings' : '' };
    }));
    group('Other CSV columns', state.customVars.map(function (v) {
      return { name: v.name, label: v.label };
    }));
  }

  function insertVariable(name) {
    var field = state.lastField || $('bodyInput');
    ui.insertAtCursor(field, '{{' + name + '}}');
  }

  /* ------------------------------------------------------------------ */
  /* Mapping dialog                                                      */
  /* ------------------------------------------------------------------ */

  function columnLabel(i) {
    var headers = state.data.headers;
    var name = headers[i];
    var dup = headers.some(function (h, j) { return j !== i && h.toLowerCase() === name.toLowerCase(); });
    return dup ? name + ' (column ' + (i + 1) + ')' : name;
  }

  function renderCsvDialog() {
    var fileRow = $('csvDialogFile');
    ui.clear(fileRow);
    if (!state.data) {
      fileRow.appendChild(el('p', null, 'Please upload a CSV file to continue.'));
      fileRow.appendChild(el('button', { type: 'button', class: 'btn btn-primary', 'data-action': 'choose-file' }, 'Choose CSV File'));
      $('mappingSection').hidden = true;
      $('resetMappingBtn').hidden = true;
      return;
    }
    var n = state.data.rows.length;
    fileRow.appendChild(el('div', null,
      el('strong', null, state.data.fileName),
      el('div', { class: 'muted small' }, n.toLocaleString() + (n === 1 ? ' record · ' : ' records · ') + state.data.headers.length + ' columns')));
    fileRow.appendChild(el('button', { type: 'button', class: 'btn btn-small', 'data-action': 'choose-file' }, 'Replace CSV'));
    $('mappingSection').hidden = false;
    $('resetMappingBtn').hidden = false;

    var body = $('mappingBody');
    ui.clear(body);
    T.PROSPECT_VARS.forEach(function (v) {
      var id = 'map-' + v.name;
      var select = el('select', { class: 'input select', id: id, 'data-map': v.name });
      select.appendChild(el('option', { value: '-1' }, '— Not mapped —'));
      state.data.headers.forEach(function (h, i) {
        select.appendChild(el('option', { value: String(i) }, columnLabel(i)));
      });
      select.value = String(state.mapping[v.name]);
      var sample = state.mapping[v.name] >= 0 ? cell(state.current, state.mapping[v.name]) : '';
      body.appendChild(el('tr', null,
        el('th', { scope: 'row' },
          el('label', { for: id }, v.label),
          el('code', { class: 'var-code' }, '{{' + v.name + '}}')),
        el('td', null, select),
        el('td', { class: 'sample' }, sample || el('span', { class: 'muted' }, '—'))
      ));
    });

    var info = $('customVarsInfo');
    ui.clear(info);
    if (state.customVars.length) {
      info.appendChild(el('p', { class: 'muted' }, 'Other columns are also available as variables:'));
      var ul = el('ul', { class: 'custom-vars' });
      state.customVars.forEach(function (v) {
        ul.appendChild(el('li', null, el('code', null, '{{' + v.name + '}}'), ' ← ' + v.label));
      });
      info.appendChild(ul);
    }
  }

  function onMappingChanged() {
    S.setKeyed('mapping', state.data.headerSig, state.mapping, 20);
    refreshCustomVars();
    computeView();
    renderTable();
    renderMappingSummary();
    renderVariableButtons();
    renderPreview();
    renderActionBar();
    renderCsvDialog();
  }

  /* ------------------------------------------------------------------ */
  /* Settings                                                            */
  /* ------------------------------------------------------------------ */

  function renderSettings() {
    var form = $('settingsForm');
    Object.keys(state.sender).forEach(function (k) {
      form.elements[k].value = state.sender[k];
    });
    form.elements.fallback.value = state.fallback;
    $('settingsSaved').textContent = '';
  }

  var announceSettingsSaved = debounce(function () {
    $('settingsSaved').textContent = 'Saved in this browser';
  }, 400);

  function onSettingsInput(event) {
    var name = event.target.name;
    if (!name) return;
    if (name === 'fallback') {
      state.fallback = event.target.value;
      S.set('fallback', state.fallback);
    } else if (Object.prototype.hasOwnProperty.call(state.sender, name)) {
      state.sender[name] = event.target.value;
      S.set('sender', state.sender);
      renderVariableButtons();
    }
    renderPreview();
    announceSettingsSaved();
  }

  function clearLocalData() {
    var ok = window.confirm(
      'Clear all local data?\n\nThis removes your sender settings, saved templates, record statuses and preferences from this browser. The loaded CSV will be closed.'
    );
    if (!ok) return;
    S.clearAll();
    window.location.reload();
  }

  /* ------------------------------------------------------------------ */
  /* Dialogs                                                             */
  /* ------------------------------------------------------------------ */

  function openDialog(id) {
    var dialog = $(id);
    if (!dialog || dialog.open) return;
    if (id === 'csvDialog') renderCsvDialog();
    if (id === 'templatesDialog') renderTemplateList();
    if (id === 'settingsDialog') renderSettings();
    Array.prototype.forEach.call(document.querySelectorAll('dialog[open]'), function (d) {
      if (d.id !== 'nameDialog') d.close();
    });
    dialog.showModal();
  }

  /* ------------------------------------------------------------------ */
  /* Copy & export                                                       */
  /* ------------------------------------------------------------------ */

  function copy(kind, button) {
    if (!state.data) return;
    var g = generate(state.current);
    var text = kind === 'subject' ? g.subject : kind === 'message' ? g.body : fullEmail(g);
    ui.copyText(text).then(function (ok) {
      if (ok) {
        ui.flashButton(button, 'Copied!');
        ui.announce((kind === 'subject' ? 'Subject' : kind === 'message' ? 'Message' : 'Full email') + ' copied');
      } else {
        ui.flashButton(button, 'Copy failed', 'is-error');
        ui.announce('Copy failed. Use the Plain text view to select and copy manually.');
      }
    });
  }

  function exportCsv(kind, button) {
    if (!state.data) return;
    var indices = kind === 'current' ? [state.current] : state.data.rows.map(function (_, i) { return i; });
    var name = ROG.exporter.exportRecords(kind, state.data, indices, generate, state.statuses);
    ui.flashButton(button, 'Exported!');
    ui.announce('Downloaded ' + name);
  }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  function isTyping(target) {
    if (!target) return false;
    var tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function bindEvents() {
    var fileInput = $('fileInput');
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      handleFile(file);
    });

    // Delegated clicks for elements that are re-rendered.
    document.addEventListener('click', function (event) {
      var t = event.target.closest('[data-action], [data-open], [data-copy], [data-var], [data-tpl-action]');
      if (!t || t.disabled) return;
      if (t.getAttribute('data-action') === 'download-template') {
        var name = ROG.exporter.downloadTemplate();
        ui.announce('Downloaded ' + name);
      } else if (t.getAttribute('data-action') === 'choose-file') {
        // The file input lives outside the dialogs, which make the rest of the page inert.
        var openDialogEl = document.querySelector('dialog[open]');
        if (openDialogEl) openDialogEl.close();
        fileInput.click();
      } else if (t.hasAttribute('data-open')) {
        openDialog(t.getAttribute('data-open'));
      } else if (t.hasAttribute('data-copy')) {
        copy(t.getAttribute('data-copy'), t);
      } else if (t.hasAttribute('data-var')) {
        insertVariable(t.getAttribute('data-var'));
      } else if (t.hasAttribute('data-tpl-action')) {
        var id = t.getAttribute('data-id');
        var action = t.getAttribute('data-tpl-action');
        if (action === 'load') {
          if (id === state.editor.templateId && !isDirty()) return;
          if (confirmDiscard()) loadTemplate(id);
        } else if (action === 'rename') {
          renameTemplate(id);
        } else if (action === 'delete') {
          deleteTemplate(id);
        }
      }
    });

    // Drag & drop anywhere on the page.
    var dragDepth = 0;
    window.addEventListener('dragenter', function (e) {
      if (!e.dataTransfer || Array.prototype.indexOf.call(e.dataTransfer.types, 'Files') === -1) return;
      dragDepth++;
      document.body.classList.add('is-dragging');
    });
    window.addEventListener('dragleave', function () {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) document.body.classList.remove('is-dragging');
    });
    window.addEventListener('dragover', function (e) {
      e.preventDefault();
    });
    window.addEventListener('drop', function (e) {
      e.preventDefault();
      dragDepth = 0;
      document.body.classList.remove('is-dragging');
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) handleFile(file);
    });

    // Records table
    if ('IntersectionObserver' in window) {
      moreObserver = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) renderMore();
      }, { root: $('tableWrap'), rootMargin: '300px' });
    }
    $('recordsBody').addEventListener('click', function (event) {
      if (event.target.closest('[data-more]')) {
        renderMore();
        return;
      }
      var tr = event.target.closest('tr[data-i]');
      if (tr) selectRecord(parseInt(tr.getAttribute('data-i'), 10));
    });
    $('search').addEventListener('input', function (event) {
      state.query = event.target.value;
      computeView();
      if (state.view.length && state.view.indexOf(state.current) === -1) state.current = state.view[0];
      renderTable();
      selectRecord(state.current, { scroll: true });
    });
    Array.prototype.forEach.call(document.querySelectorAll('.sort-btn'), function (btn) {
      btn.addEventListener('click', function () {
        var key = btn.getAttribute('data-sort');
        state.sort = state.sort.key === key ? { key: key, dir: -state.sort.dir } : { key: key, dir: 1 };
        savePrefs();
        computeView();
        renderTable();
        selectRecord(state.current, { scroll: true });
      });
    });

    // Navigation
    $('prevBtn').addEventListener('click', function () { step(-1); });
    $('nextBtn').addEventListener('click', function () { step(1); });
    document.addEventListener('keydown', function (event) {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (isTyping(event.target) || document.querySelector('dialog[open]')) return;
      if (event.key === 'ArrowLeft') { step(-1); event.preventDefault(); }
      else if (event.key === 'ArrowRight') { step(1); event.preventDefault(); }
    });

    // Status
    $('statusSelect').addEventListener('change', function (event) {
      if (!state.data) return;
      state.statuses[state.current] = event.target.value;
      updateRowStatus(state.current);
      saveStatuses();
      ui.announce('Status set to ' + event.target.value);
    });

    // Export
    $('exportCurrentBtn').addEventListener('click', function (e) { exportCsv('current', e.currentTarget); });
    $('exportAllBtn').addEventListener('click', function (e) { exportCsv('all', e.currentTarget); });

    // Editor
    ['subjectInput', 'bodyInput'].forEach(function (id) {
      var field = $(id);
      field.addEventListener('input', onEditorInput);
      field.addEventListener('focus', function () { state.lastField = field; });
    });
    $('templateSelect').addEventListener('change', function (event) {
      var id = event.target.value;
      if (id && id !== state.editor.templateId && confirmDiscard()) loadTemplate(id);
      else event.target.value = state.editor.templateId || '';
    });
    $('saveTemplateBtn').addEventListener('click', saveTemplate);
    $('saveAsTemplateBtn').addEventListener('click', saveTemplateAs);
    $('dialogSaveAsBtn').addEventListener('click', saveTemplateAs);
    $('restoreDefaultBtn').addEventListener('click', restoreDefault);

    // Preview mode
    Array.prototype.forEach.call(document.querySelectorAll('.seg-btn'), function (b) {
      b.addEventListener('click', function () { setPreviewMode(b.getAttribute('data-mode')); });
    });

    // Mapping
    $('mappingBody').addEventListener('change', function (event) {
      var name = event.target.getAttribute('data-map');
      if (!name || !state.data) return;
      state.mapping[name] = parseInt(event.target.value, 10);
      onMappingChanged();
      var again = $('map-' + name);
      if (again) again.focus();
    });
    $('resetMappingBtn').addEventListener('click', function () {
      if (!state.data) return;
      state.mapping = T.autoMap(state.data.headers);
      onMappingChanged();
    });

    // Settings
    $('settingsForm').addEventListener('input', onSettingsInput);
    $('clearDataBtn').addEventListener('click', clearLocalData);
  }

  /* ------------------------------------------------------------------ */
  /* Init                                                                */
  /* ------------------------------------------------------------------ */

  function init() {
    loadPersisted();
    renderEditor();
    renderVariableButtons();
    renderRecordsPanel();
    setPreviewMode(state.previewMode);
    renderActionBar();
    bindEvents();
  }

  init();
})(window.ROG);

/*
 * Logic tests for the CSV parser and template engine.
 * Run with: node tests/run.js   (no dependencies)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { window: {} };
vm.createContext(ctx);
['csv.js', 'template.js'].forEach((f) => {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8'), ctx, { filename: f });
});
const { csv, template } = ctx.window.ROG;

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (e) {
    console.error('  FAIL ' + name + '\n       ' + e.message);
    process.exitCode = 1;
  }
}
function throwsMessage(fn, message) {
  assert.throws(fn, (e) => e.message === message);
}
const plain = (x) => JSON.parse(JSON.stringify(x));

console.log('CSV');
test('parses quoted fields, escaped quotes and embedded newlines', () => {
  const r = csv.parse('Name,Note\r\n"A, Inc","He said ""hi""\nbye"\r\nB,plain\r\n');
  assert.deepStrictEqual(plain(r.headers), ['Name', 'Note']);
  assert.deepStrictEqual(plain(r.rows), [['A, Inc', 'He said "hi"\nbye'], ['B', 'plain']]);
});
test('strips BOM and handles missing trailing newline', () => {
  const r = csv.parse('﻿a,b\n1,2');
  assert.deepStrictEqual(plain(r.headers), ['a', 'b']);
  assert.deepStrictEqual(plain(r.rows), [['1', '2']]);
});
test('detects semicolon and tab delimiters', () => {
  assert.deepStrictEqual(plain(csv.parse('a;b\n1;2').rows), [['1', '2']]);
  assert.deepStrictEqual(plain(csv.parse('a\tb\n1\t2').rows), [['1', '2']]);
});
test('skips completely empty rows and reports them', () => {
  const r = csv.parse('a,b\n1,2\n,\n\n3,4\n');
  assert.strictEqual(r.rows.length, 2);
  assert.ok(r.warnings.some((w) => /Skipped 2 completely empty rows/.test(w)));
});
test('pads short rows and keeps extra values as new columns', () => {
  const r = csv.parse('a,b\n1\n1,2,3\n');
  assert.deepStrictEqual(plain(r.headers), ['a', 'b', 'Column 3']);
  assert.deepStrictEqual(plain(r.rows), [['1', '', ''], ['1', '2', '3']]);
});
test('names missing headers and warns about duplicates', () => {
  const r = csv.parse('Email,,Email\nx,y,z\n');
  assert.deepStrictEqual(plain(r.headers), ['Email', 'Column 2', 'Email']);
  assert.ok(r.warnings.some((w) => /Duplicate column names: Email/.test(w)));
});
test('rejects empty file, header-only file, blank header and bad quoting', () => {
  throwsMessage(() => csv.parse(''), csv.EMPTY_MESSAGE);
  throwsMessage(() => csv.parse('  \n\n'), csv.EMPTY_MESSAGE);
  throwsMessage(() => csv.parse('a,b\n'), csv.EMPTY_MESSAGE);
  throwsMessage(() => csv.parse('a,b\n,\n'), csv.EMPTY_MESSAGE);
  throwsMessage(() => csv.parse(',,\n1,2,3'), csv.EMPTY_MESSAGE);
  throwsMessage(() => csv.parse('a,b\n"unterminated,2\n'), csv.INVALID_MESSAGE);
  throwsMessage(() => csv.parse('PK\u0003\u0004\u0000\u0000binary'), csv.INVALID_MESSAGE);
});
test('stringify round-trips tricky values', () => {
  const rows = [['h1', 'h2'], ['a,b', 'say "x"'], ['line\nbreak', ' padded ']];
  const text = csv.stringify(rows);
  const back = csv.parse(text);
  assert.deepStrictEqual(plain([back.headers].concat(back.rows)), rows);
});

console.log('Template');
test('auto-maps common header names', () => {
  const headers = ['Business Name', 'Owner Name', 'E-mail', 'Phone Number', 'Total Reviews', 'Last Review', 'Reviews Last Month', 'Google Review Link', 'Zip Code', 'Website'];
  const m = template.autoMap(headers);
  assert.strictEqual(m.business_name, 0);
  assert.strictEqual(m.owner_name, 1);
  assert.strictEqual(m.email, 2);
  assert.strictEqual(m.phone, 3);
  assert.strictEqual(m.total_reviews, 4);
  assert.strictEqual(m.last_review, 5);
  assert.strictEqual(m.reviews_last_month, 6);
  assert.strictEqual(m.review_link, 7);
  assert.strictEqual(m.zip, 8);
  assert.strictEqual(m.website, 9);
  assert.strictEqual(m.city, -1);
});
test('auto-map prefers company over generic name, and uses contains-matching', () => {
  const m = template.autoMap(['Name', 'Company', 'Primary Email', 'Number of Google Reviews']);
  assert.strictEqual(m.business_name, 1);
  assert.strictEqual(m.owner_name, 0);
  assert.strictEqual(m.email, 2);
  assert.strictEqual(m.total_reviews, 3);
});
test('reviews_last_month is not swallowed by total_reviews', () => {
  const m = template.autoMap(['Title', 'Reviews (last 30 days)', 'Review Count']);
  assert.strictEqual(m.business_name, 0);
  assert.strictEqual(m.total_reviews, 2);
  assert.strictEqual(m.reviews_last_month, 1);
});
test('exposes unmapped columns as custom variables', () => {
  const headers = ['Business Name', 'Category', 'Years in Business', '2024 Revenue'];
  const vars = template.customVariables(headers, template.autoMap(headers));
  assert.deepStrictEqual(plain(vars.map((v) => v.name)), ['category', 'years_in_business', 'col_2024_revenue']);
});
test('renders variables, flags unknown ones, applies fallback', () => {
  const values = { business_name: 'ABC Roofing', owner_name: '' };
  const resolve = (n) => (n in values ? { known: true, value: values[n] } : { known: false });
  const r = template.render('Hi {{ business_name }} / {{owner_name}} / {{nope}} / {{Business_Name}}', resolve, '[n/a]');
  assert.strictEqual(r.text, 'Hi ABC Roofing / [n/a] / {{nope}} / ABC Roofing');
  const unknown = r.segments.filter((s) => s.type === 'var' && !s.known).map((s) => s.name);
  assert.deepStrictEqual(plain(unknown), ['nope']);
  assert.strictEqual(template.render('{{owner_name}}!', resolve, '').text, '!');
});
test('never outputs null / undefined / NaN', () => {
  assert.strictEqual(template.cleanValue(null), '');
  assert.strictEqual(template.cleanValue(undefined), '');
  assert.strictEqual(template.cleanValue('NaN'), '');
  assert.strictEqual(template.cleanValue(' null '), '');
  assert.strictEqual(template.cleanValue(' 42 '), '42');
});
test('default template matches the spec', () => {
  const t = template.DEFAULT_TEMPLATE;
  assert.strictEqual(t.name, 'Review Outreach');
  assert.strictEqual(t.subject, 'Quick Review Audit for {{business_name}}');
  assert.ok(t.body.startsWith('Hello {{business_name}} Team,\n\nWe recently visited'));
  assert.ok(t.body.endsWith('{{my_name}}\n{{my_company}}\n{{my_phone}}'));
});

console.log('\n' + passed + ' passed' + (process.exitCode ? ', some FAILED' : ''));

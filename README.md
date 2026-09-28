# Review Outreach Generator

A lightweight, browser-based tool for turning a CSV of local businesses into personalized review-outreach emails.

**Upload → Map → Template → Preview → Copy → Next → Export.** It doesn't send email, track anything or store data on a server.

> Your CSV data is processed locally in your browser. No prospect data is uploaded to a server.

## Running it

It has no build step and no dependencies.

- **Locally:** open `index.html` in a modern browser (Chrome, Edge, Firefox or Safari).
- **Hosted:** upload the folder to any static host (GitHub Pages, Netlify, S3, an internal web server).

Try it with `samples/sample-prospects.csv`.

### CSV template

To start your own list, use **Download CSV template** (on the upload card or under **CSV**), or copy `samples/review-outreach-template.csv`. The template has one column for each prospect variable, and every column maps automatically:

```text
Business Name,Owner Name,Email,Phone,Address,City,State,ZIP,Website,Total Reviews,Last Review,Reviews Last Month,Review Link
```

Delete the two example rows before you add your own. You can leave out columns you don't need, and you can add your own columns (e.g. `Category`, which becomes `{{category}}`).

## Features

- CSV import by file picker or drag and drop. Supports quoted fields, embedded commas and newlines, and comma, semicolon or tab delimiters. UTF-8 is the default, with a Windows-1252 fallback.
- Validation for file type, empty files, missing or duplicate headers, broken quoting and completely empty rows. Rows that are too short or too long are handled gracefully.
- Automatic column mapping for common header names (e.g. `Business Name`, `Company`, `Total Reviews`, `Review Count`, `E-mail`). You can also edit the mapping manually, and the tool remembers it for files with the same headers.
- A template editor with a subject, a message and click-to-insert variable buttons that insert at the cursor.
- A live preview in Email or Plain-text view. Unknown variables are highlighted and flagged. Unmapped, empty and unset sender values are listed.
- Search across all columns and sortable columns. Previous/Next navigation also works with the ← / → keys when you're not typing.
- Copy Subject, Copy Message and Copy Full Email buttons.
- A status for each record (Pending / Ready / Sent), remembered per file in this browser.
- Export All and Export Current. Original columns are kept, and `Generated Subject`, `Generated Message` and `Status` are appended. Re-importing an exported file restores the statuses.
- Saved templates (save, save as, load, rename, delete), sender settings and an optional fallback text for empty values. All of these live in LocalStorage and can be removed with **Settings → Clear Local Data**.

## Variables

Variables use the syntax `{{variable_name}}`.

| Prospect (from CSV) | Sender (from Settings) |
|---|---|
| `{{business_name}}` `{{owner_name}}` `{{email}}` `{{phone}}` `{{address}}` `{{city}}` `{{state}}` `{{zip}}` `{{website}}` `{{total_reviews}}` `{{last_review}}` `{{reviews_last_month}}` `{{review_link}}` | `{{my_name}}` `{{my_company}}` `{{my_phone}}` `{{my_email}}` `{{my_website}}` |

CSV columns that aren't mapped to a standard variable are also available under their own name. For example, a `Category` column becomes `{{category}}`.

Empty values are rendered as blank, or as the fallback text set in Settings. The output never contains `undefined`, `null` or `NaN`.

**Tip:** the default template says *"review posted {{last_review}} ago"*. So your `Last Review` column should contain values like `3 weeks`, not `3 weeks ago`. Otherwise the email will say "ago ago".

## Project structure

```text
index.html          App shell and dialogs
css/style.css       Styles (responsive; desktop-first)
js/csv.js           CSV parser/validator and serializer
js/template.js      Variables, auto-mapping, rendering, default template
js/storage.js       LocalStorage wrapper
js/export.js        CSV export and download
js/ui.js            DOM helpers (safe text rendering, clipboard, dialogs)
js/app.js           State and event wiring
assets/logo.svg     Logo / favicon
samples/            Example data and the blank CSV template
tests/run.js        Logic tests (node tests/run.js)
```

## Security and privacy

- All processing happens in the browser. A Content-Security-Policy with `connect-src 'none'` stops the page from making network requests.
- CSV content is treated as untrusted text. It is only inserted with `textContent`, never as HTML. There is no `eval`.
- Exported values are written as they are. If your CSV comes from an untrusted source, keep in mind that spreadsheet apps may interpret cells that start with `=`, `+`, `-` or `@` as formulas.

## Tests

```bash
node tests/run.js
```

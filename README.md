# Payslip

A local-first tool for reading and comparing UK payslips. Payslip files, extracted values, and originals stay on the computer running the app. It does not use external OCR, AI, analytics, telemetry, cloud storage, or remote databases.

## Run locally

Requirements: Node.js 20 or later and npm.

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). To run the optimized app:

```sh
npm run build
npm run start
```

Other checks: `npm run lint`, `npm run typecheck`, and `npm test`.

For isolated Chromium browser journeys (imports, statistics/exports and safe deletion):

```sh
npx playwright install chromium
npm run test:e2e
```

The browser runner creates a separate production build under `.next-e2e/` so it does not disrupt a running development server. It starts on port 3107 with a newly created temporary SQLite database and storage directory, then removes that synthetic test data. It refuses to reuse an existing server, and destructive test requests require the isolated-instance marker. No normal app records are used by these tests.

## Local storage

- SQLite database: `prisma/dev.db`
- Original uploaded documents: `.payslip-data/originals/`
- OCR English language data: installed under `node_modules/` and cached under `.payslip-data/tesseract/`

These files are local to the app directory. Keep the app directory private and back it up only if you want to retain its payslip data. The original files are stored under generated names; their original filename is kept with the local record. Password-protected PDFs remain protected originals. The PDF PIN is used only for the current import and is not saved.

## Privacy and processing

The browser sends a selected file only to the local Next.js server at `localhost` so the document can be processed and saved on this computer. Server endpoints reject non-local host requests. PDF.js extracts embedded PDF text locally; protected PDFs request a PIN, which is passed only to the local PDF reader. If a PDF is scanned or an image is uploaded, PDF.js renders pages locally and Tesseract.js runs with bundled English language data. Next.js telemetry is disabled for the development, build, and start commands. No external OCR, AI, analytics, or telemetry service is contacted.

Imports accept PDF, PNG, JPG, or JPEG files up to 20 MB each, and Gmail Takeout `.mbox` files (including hidden names such as `.Payslip.mbox`) up to 5 GB. An incorrect PDF PIN is reported and not retained. Extracted fields include their source text and confidence, and line-level/manual corrections preserve the original extracted amount.

## Gmail Takeout / MBOX imports

Drop an MBOX file on the dashboard or choose it using **Choose files**. The browser sends successive 4 MB slices to the loopback-only local server; it never converts the full mailbox to text or reads it into browser memory. The server saves a temporary mailbox under `.payslip-data/temp/`, streams it message by message, and uses the Node `mailparser` MIME parser. Each email is limited to 32 MB, each candidate attachment to 20 MB, and each import to 10,000 candidate attachments. These limits protect local memory. Larger mailboxes can be split into smaller Gmail label exports.

PDF attachments are candidates even without payroll wording. Images are candidates when their filename, sender, subject or plain-text body mentions pay-related terms. File signatures are checked, not just extensions or MIME headers. HTML email is never rendered, scripts are never executed, and original filenames are never used as filesystem paths.

The Gmail results show actual scanned/skipped/malformed email counts, candidate attachments, duplicates and each attachment's result. SHA-256 prevents identical documents being imported twice across mailboxes and normal uploads. Previously imported documents are indexed from their local originals where available. Email date, sender, recipient, subject and attachment filename are retained in SQLite; the full email body and raw mailbox are not retained. If the document has no identifiable pay date, its email date is used as a **low-confidence fallback**, clearly marked in the detail page.

Protected attachments remain locally staged and are shown in the results. Enter a PIN for one attachment or apply it to all protected attachments. Wrong PINs leave attachments available for another attempt. PINs are never saved. Import results survive reloads. A disconnected processing response does not discard results; reload to review them.

The temporary MBOX is deleted after processing (including parse failures) and cancelled uploads are cleaned up. Interrupted uploads left by a browser/server crash expire after 24 hours and are cleaned up when the next import starts. Extracted attachment originals and useful metadata remain until deleted; **Data → Clear all data** also removes protected/staged attachments and Gmail metadata. It is disabled while an import is actively running.

For isolated local testing, `PAYSLIP_DATA_DIR` can point to another data directory, and `DATABASE_URL` can point to another SQLite file. Both are trusted server-side environment settings, never browser-supplied paths. Without overrides, the storage locations above apply. No real MBOX/EML files, data directories or payslip documents should be committed; ignore rules cover them.

## Delete data

Open **Data** for actual payslip/email/attachment/import/original counts and measured storage use (including the SQLite database and journals). Original counts and sizes come from the filesystem without following symbolic links.

**Clear all data** has two steps: review the counts and irreversible scope, then type **DELETE** exactly and explicitly select **Delete everything**. Enter in the confirmation input never submits. The local API also requires exact `DELETE` and an acknowledgment; the legacy delete-all endpoint enforces the same contract.

Deletion refuses active imports or local writes. It stages controlled document/temp/preview/thumbnail/cache folders locally, deletes records in a SQLite transaction, and only then removes staged files. An uncommitted failure restores staged originals; a committed cleanup failure is reported and can be retried. A persistent transaction token distinguishes the two states after a crash. SQLite secure deletion and compaction remove deleted records from its reusable pages. The app code, configuration, dependencies, database schema and reusable OCR language cache are not deleted. OS backups or previously downloaded exports are outside the app's control.

Dashboard, history, comparison, Statistics and Gmail results reset immediately, including in other open app tabs. Only app-prefixed browser preferences are removed; PINs are never saved. Imports can start again after clearing. Do not manually delete the database or originals while the app is running.

## Statistics

The **Statistics** page provides six compact views: Overview, Pay & deductions, Hours & earnings, Patterns, Periods and Data quality. Date presets/custom boundaries, employer and inferred pay frequency filter every result. Totals, observed-count averages/medians/extrema, current-pay and hourly trends, composition donuts, distributions/box plots/histograms, Pearson correlations, pay changes, monthly/yearly/employer tables, YTD checks and reconciliation all use the selected records. Figures, chart points, bins and period rows drill down to actual payslips. Tables and drill-down lists are paginated; calculations are memoized and require no chart service. CSV and JSON exports are generated entirely in the browser for the current selection.

Calculation conventions:

- Missing/non-finite values are excluded, **never zero-filled**. Genuine zeros remain observed. Coverage is shown; extraction confidence is not a guarantee of accuracy.
- Labelled period Total Payments, Total Deductions and Net Pay are parsed separately. Gross-minus-net is a distinct arithmetic comparison and is never substituted for printed total deductions. Net-above-gross is explained only when the labelled deduction reconciles.
- BaseA(HRS) columns map to worked hours, printed hourly rate and earning amount; HOLW maps to separate holiday hours, rate and pay. The printed gross amount remains authoritative; hours × rate only flags row consistency. Repeated BaseA rows are summed for hours and BaseA gross, with each source row preserved; ambiguous differing rates are not collapsed into one printed rate.
- Total paid hours is shown only when both worked and holiday hours are observed. Component totals use only known components and keep refund signs. Component percentages use paired observations, not mismatched aggregate denominators.
- Gross/net hourly pay requires positive observed hours and the respective pay amount. Per-payslip average hourly rates differ from monthly/yearly weighted rates: those use summed pay divided by summed hours on matched records. Net retention and effective rates likewise use matched observations. Printed/contracted hourly rates are not substituted for missing hours.
- Current earning composition excludes gross/net summaries, YTD, hours, rates and employer contributions. Overtime/bonus/holiday/employer pension are shown only when explicitly found. Future imports preserve explicitly printed tax codes, NI categories and loan plans. Existing records are not automatically reparsed: inspect `npm run reparse:review` first, then explicitly use `npm run reparse:apply` to save a new extraction revision while retaining the previous values and source evidence. `npm run reparse:restore` restores version 1 if no manual edits have been made since the reparse.
- The gross allocation donut uses only completely itemised, penny-reconciled records. Missing optional deductions are **not** assumed zero. Other composition charts describe their observed component sum, which can have partial coverage; negative entries are listed separately from positive donut slices.
- Pay changes stay within an employer and compare previous distinct observed dates. Month/year changes use the previous observed period, with coverage/gaps disclosed. Previous-window overview comparisons appear only for a dated filter and actual observations in the adjacent equal-length calendar window; they do not imply equal payroll coverage.
- Consistency uses population variance and SD. CV = SD / absolute mean; CV <=5% is Very consistent, <=15% Mostly consistent, <=30% Variable, >30% Highly variable. Fewer than two values/undefined CV is insufficient. Quartiles use inclusive linear interpolation (type 7). Pearson correlation requires three nonconstant paired values and does not establish causation.
- Pay frequency is an **uncertain inference** from distinct dates per employer (two gaps minimum; >=70% matching weekly 5-9, fortnightly 12-16, four-weekly 26-29 or monthly 28-33 days). Overlapping bands, missing records and multiple pay runs can affect it.
- Printed YTD is the latest available printed snapshot per employer in the relevant UK tax year, starting 6 April. It is **never summed**. Differences from selected calculated totals can reflect incomplete imports, date filtering or different payroll definitions. Reconciliation requires every explicit component, allows one penny, and never adjusts values.

Gmail results collapse to an actual count summary by default after a completed import. The accessible accordion remembers `payslip-gmail-import-collapsed` locally, shows 12 attachments per page when expanded, and cannot hide active upload/processing/PIN progress. No-import and post-clear states start expanded.

Tests use synthetic documents and independent temporary SQLite/storage directories. Destructive checks never touch the normal database or private originals.

## Limitations

Payslip formats vary. The parser uses flexible UK payroll labels and never fills unidentified figures with zero, but extraction and OCR can misread unfamiliar layouts. Review extracted amounts and edit them before relying on them. The reconciliation and hourly-rate figures are estimates, not official payroll or tax calculations. OCR currently uses the bundled English model. This is a local single-user utility, not an encrypted multi-user service; protect access to your computer and app folder.

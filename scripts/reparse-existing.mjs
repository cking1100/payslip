import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";

const require = createRequire(`${process.cwd()}\\`);
require("dotenv").config({ quiet: true });
const { PrismaClient } = require("@prisma/client");
const ts = require("typescript");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const restore = args.includes("--restore-v1");
if (args.length > 1 || apply && restore || args.some((argument) => !["--apply", "--dry-run", "--restore-v1"].includes(argument))) {
  console.error("Usage: node scripts/reparse-existing.mjs [--dry-run | --apply | --restore-v1]");
  process.exit(2);
}

const parserPath = path.join(process.cwd(), "src", "lib", "parser.ts");
const parserSource = await readFile(parserPath, "utf8");
const javascript = ts.transpileModule(parserSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const parserExports = {};
new Function("exports", javascript)(parserExports);
const { parsePayslip } = parserExports;
const prisma = new PrismaClient();
const columns = [
  "grossPay", "netPay", "tax", "nationalInsurance", "pension", "studentLoan", "otherDeductions",
  "hoursWorked", "hourlyRate", "grossYtd", "taxYtd", "nationalInsuranceYtd", "pensionYtd", "netYtd",
];

function oldSnapshot(record) {
  return {
    parserVersion: "legacy",
    values: Object.fromEntries(columns.map((key) => [key, record[key]])),
    lines: record.lines,
    fields: record.fields,
  };
}

function parsedSnapshot(parsed, values) {
  return { parserVersion: "template-aware-v2", values, fields: parsed.fields, attributes: parsed.attributes, lines: parsed.lines };
}

function sourceText(record) {
  const sources = record.lines.map((line) => line.sourceText).filter((text) => typeof text === "string" && text.length > 0);
  const present = new Set(sources);
  for (const field of record.fields) {
    if (field.sourceText && !present.has(field.sourceText)) {
      sources.push(field.sourceText);
      present.add(field.sourceText);
    }
  }
  return sources.join("\n");
}

async function storeField(tx, payslipId, key, field, previous) {
  const value = field?.amount === null || field?.amount === undefined
    ? field?.value ?? null
    : String(field.amount);
  const data = {
    value,
    originalValue: previous?.originalValue ?? previous?.value ?? null,
    label: field?.label ?? key,
    confidence: field?.confidence ?? "Low",
    sourceText: field?.sourceText ?? null,
    page: field?.page ?? null,
    manuallyCorrected: false,
  };
  await tx.payslipField.upsert({
    where: { payslipId_key: { payslipId, key } },
    create: { payslipId, key, ...data },
    update: data,
  });
}

try {
  if (restore) {
    const records = await prisma.payslip.findMany({
      where: { extractionVersion: { gte: 2 } },
      include: { fields: true, lines: true, extractionRevisions: { where: { version: 1 } } },
    });
    if (records.some((record) => record.fields.some((field) => field.manuallyCorrected)
      || record.lines.some((line) => line.manuallyCorrected)
      || !record.extractionRevisions.length)) {
      throw new Error("A record has manual edits or lacks its version-1 snapshot; no records were changed.");
    }
    let restored = 0;
    for (const record of records) {
      const previous = JSON.parse(record.extractionRevisions[0].payload);
      await prisma.$transaction(async (tx) => {
        await tx.payslip.update({
          where: { id: record.id },
          data: { ...previous.values, extractionVersion: 1 },
        });
        await tx.payslipField.deleteMany({ where: { payslipId: record.id } });
        if (previous.fields.length) await tx.payslipField.createMany({ data: previous.fields });
        await tx.payslipLine.deleteMany({ where: { payslipId: record.id } });
        if (previous.lines.length) await tx.payslipLine.createMany({ data: previous.lines });
      });
      restored++;
    }
    console.log(JSON.stringify({ mode: "restore-v1", restoredRecords: restored }, null, 2));
    process.exitCode = 0;
  } else {
  const records = await prisma.payslip.findMany({
    include: { lines: { orderBy: { id: "asc" } }, fields: { orderBy: { id: "asc" } } },
    orderBy: { id: "asc" },
  });
  const report = {
    mode: apply ? "apply" : "dry-run",
    recordsScanned: records.length,
    alreadyVersion2: 0,
    sourceRowsReparsed: 0,
    readyForVersion2: 0,
    incompletePeriodTotals: 0,
    totalReconciled: 0,
    totalReview: 0,
    baseARows: 0,
    baseAReconciled: 0,
    baseAReview: 0,
    holwRows: 0,
    ytdGrossFound: 0,
    ytdTaxFound: 0,
    ytdNIFound: 0,
    correctedNetAboveGross: 0,
    unexplainedNetAboveGross: 0,
    legacyNetAboveGross: 0,
    manuallyEditedRecords: 0,
    updatedRecords: 0,
    skippedRecords: 0,
  };
  const plans = [];

  for (const record of records) {
    if (record.extractionVersion >= 2) {
      report.alreadyVersion2++;
      continue;
    }
    const manuallyEdited = record.lines.some((line) => line.manuallyCorrected)
      || record.fields.some((field) => field.manuallyCorrected);
    if (manuallyEdited) report.manuallyEditedRecords++;
    const parsed = parsePayslip(sourceText(record));
    report.sourceRowsReparsed++;
    const fields = parsed.fields;
    const totalReady = fields.grossPay?.amount !== null && fields.grossPay?.amount !== undefined
      && fields.netPay?.amount !== null && fields.netPay?.amount !== undefined
      && fields.totalDeductions?.amount !== null && fields.totalDeductions?.amount !== undefined;
    const totalValidation = parsed.attributes.totalSummaryValidation?.value;
    if (totalValidation === "passed") report.totalReconciled++;
    if (totalValidation === "review") report.totalReview++;
    const baseRows = parsed.lines.filter((line) => line.label === "BaseA");
    const holwRows = parsed.lines.filter((line) => line.label === "HOLW");
    report.baseARows += baseRows.length;
    report.holwRows += holwRows.length;
    if (parsed.attributes.baseRowValidation?.value === "passed") report.baseAReconciled += baseRows.length;
    if (parsed.attributes.baseRowValidation?.value === "review") report.baseAReview += baseRows.length;
    if (fields.grossYtd) report.ytdGrossFound++;
    if (fields.taxYtd) report.ytdTaxFound++;
    if (fields.nationalInsuranceYtd) report.ytdNIFound++;
    if (totalReady) {
      report.readyForVersion2++;
      if (fields.netPay.amount > fields.grossPay.amount) {
        report.correctedNetAboveGross++;
        const deductions = fields.totalDeductions.amount;
        if (Math.abs(fields.grossPay.amount - deductions - fields.netPay.amount) > 0.02) report.unexplainedNetAboveGross++;
      }
    } else {
      report.incompletePeriodTotals++;
    }
    if (record.grossPay !== null && record.netPay !== null && record.netPay > record.grossPay) report.legacyNetAboveGross++;
    plans.push({ record, parsed, totalReady, manuallyEdited });
  }

  if (report.totalReview || report.baseAReview) {
    throw new Error("The dry-run found payroll rows that need review; no records were changed.");
  }
  if (apply && report.manuallyEditedRecords) {
    throw new Error("Manually edited records were found; no records were changed. Review and migrate them separately.");
  }
  if (apply && report.readyForVersion2 === 0) {
    throw new Error("No records passed the labelled-total checks; no records were changed.");
  }

  if (apply) {
    for (const { record, parsed, totalReady } of plans) {
      if (!totalReady) {
        report.skippedRecords++;
        continue;
      }
      const values = Object.fromEntries(columns.map((key) => [key, parsed.fields[key]?.amount ?? null]));
      const revisionOne = oldSnapshot(record);
      const revisionTwo = parsedSnapshot(parsed, values);
      const oldLinesBySource = new Map();
      for (const line of record.lines) {
        if (!line.sourceText) continue;
        const queue = oldLinesBySource.get(line.sourceText) ?? [];
        queue.push(line.amount);
        oldLinesBySource.set(line.sourceText, queue);
      }

      await prisma.$transaction(async (tx) => {
        await tx.payslipExtractionRevision.createMany({
          data: [
            { payslipId: record.id, version: 1, parserVersion: "legacy", payload: JSON.stringify(revisionOne) },
            { payslipId: record.id, version: 2, parserVersion: "template-aware-v2", payload: JSON.stringify(revisionTwo) },
          ],
        });
        await tx.payslip.update({ where: { id: record.id }, data: { ...values, extractionVersion: 2 } });

        const persistedKeys = new Set([
          ...Object.keys(parsed.fields),
          ...Object.keys(parsed.attributes),
        ]);
        for (const key of columns) {
          const previous = record.fields.find((field) => field.key === key);
          if (persistedKeys.has(key)) continue;
          if (previous) await tx.payslipField.update({
            where: { id: previous.id },
            data: { value: null, originalValue: previous.originalValue ?? previous.value, confidence: "Low", manuallyCorrected: false },
          });
        }
        for (const [key, field] of Object.entries(parsed.fields)) {
          await storeField(tx, record.id, key, field, record.fields.find((previous) => previous.key === key));
        }
        for (const [key, field] of Object.entries(parsed.attributes)) {
          await storeField(tx, record.id, key, field, record.fields.find((previous) => previous.key === key));
        }

        await tx.payslipLine.deleteMany({ where: { payslipId: record.id } });
        if (parsed.lines.length) await tx.payslipLine.createMany({
          data: parsed.lines.map((line) => {
            const prior = line.sourceText ? oldLinesBySource.get(line.sourceText)?.shift() : undefined;
            return {
              payslipId: record.id,
              ...line,
              originalAmount: prior ?? line.amount,
              manuallyCorrected: false,
            };
          }),
        });
      });
      report.updatedRecords++;
    }
  }

  report.skippedRecords ||= report.incompletePeriodTotals;
  console.log(JSON.stringify(report, null, 2));
  if (!apply) console.log("Preview only: the database and original documents were not changed. Use --apply only after reviewing these aggregate results.");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "Reparse failed.");
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

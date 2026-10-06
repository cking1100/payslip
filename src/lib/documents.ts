import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { extractPayslip } from "./extract";
import type { ParsedPayslip } from "./parser";
import { localDataDirectory } from "./local-data";

export const originalsDirectory = path.join(localDataDirectory, "originals");
export const maxDocumentBytes = 20 * 1024 * 1024;

export function safeText(value: string | undefined | null, max = 180): string {
  return (value ?? "").replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim().slice(0, max);
}

export function safeFilename(value: string): string {
  return safeText(value.replaceAll("\\", "/").split("/").pop()) || "attachment";
}

export function documentType(buffer: Buffer): { extension: string; mimeType: string } | null {
  if (buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) return { extension: ".pdf", mimeType: "application/pdf" };
  if (buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: ".png", mimeType: "image/png" };
  if (buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return { extension: ".jpg", mimeType: "image/jpeg" };
  return null;
}

export function contentHash(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function removeOriginal(storedFilename: string): Promise<void> {
  if (!storedFilename) return;
  try {
    await unlink(path.join(originalsDirectory, path.basename(storedFilename)));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export async function indexExistingDocuments(): Promise<void> {
  const records = await prisma.payslip.findMany({ where: { contentHash: null, storedFilename: { not: null } }, select: { id: true, storedFilename: true } });
  for (const record of records) {
    const hash = createHash("sha256");
    const source = createReadStream(path.join(originalsDirectory, path.basename(record.storedFilename!)));
    try {
      for await (const chunk of source) hash.update(chunk);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    } finally {
      source.destroy();
    }
    const sha256 = hash.digest("hex");
    if (!(await prisma.payslip.findUnique({ where: { contentHash: sha256 } }))) {
      try {
        await prisma.payslip.update({ where: { id: record.id }, data: { contentHash: sha256 } });
      } catch (error) {
        if (!(error && typeof error === "object" && "code" in error && error.code === "P2002")) throw error;
      }
    }
  }
}

function extractionData(parsed: ParsedPayslip) {
  const keys = ["grossPay", "netPay", "tax", "nationalInsurance", "pension", "studentLoan", "otherDeductions",
    "hoursWorked", "hourlyRate", "grossYtd", "taxYtd", "nationalInsuranceYtd", "pensionYtd", "netYtd"] as const;
  const amounts = Object.fromEntries(keys.map((key) => [key, parsed.fields[key]?.amount ?? null]));
  return {
    ...amounts,
    employer: parsed.employer,
    employeeName: parsed.employeeName,
    payDate: parsed.payDate ? new Date(parsed.payDate) : null,
    periodStart: parsed.periodStart ? new Date(parsed.periodStart) : null,
    periodEnd: parsed.periodEnd ? new Date(parsed.periodEnd) : null,
  };
}

export async function importDocument(buffer: Buffer, filename: string, options: {
  pin?: string; attachmentId?: string; storedFilename?: string; emailDate?: Date | null;
} = {}) {
  if (!buffer.length || buffer.length > maxDocumentBytes) throw new Error("Payslip attachments must be smaller than 20 MB.");
  const type = documentType(buffer);
  if (!type) throw new Error("This attachment isn't a valid PDF, PNG or JPG.");
  const hash = contentHash(buffer);
  const existing = await prisma.payslip.findUnique({ where: { contentHash: hash }, include: { lines: true, fields: true } });
  if (existing) return { payslip: existing, duplicate: true, ocrUsed: false };
  const extracted = await extractPayslip(buffer, type.extension, options.pin);
  const storedFilename = options.storedFilename ?? `${randomUUID()}${type.extension}`;
  const owned = !options.storedFilename;
  if (owned) {
    await mkdir(originalsDirectory, { recursive: true });
    await writeFile(path.join(originalsDirectory, storedFilename), buffer, { flag: "wx" });
  }
  const data = extractionData(extracted.parsed);
  try {
    const payslip = await prisma.$transaction(async (tx) => {
      const saved = await tx.payslip.create({
      data: {
        ...data,
        extractionVersion: 2,
        filename: safeFilename(filename),
        storedFilename,
        contentHash: hash,
        attachmentId: options.attachmentId,
        // Email date is a fallback, not a date extracted from the document.
        payDate: data.payDate ?? options.emailDate ?? null,
        lines: { create: extracted.parsed.lines.map((line) => ({ ...line, originalAmount: line.amount })) },
        fields: { create: [
          ...Object.entries(extracted.parsed.fields).map(([key, field]) => ({
            key, value: field.amount === null ? null : String(field.amount),
            originalValue: field.amount === null ? null : String(field.amount),
            label: field.label, confidence: field.confidence, sourceText: field.sourceText, page: field.page,
          })),
          ...Object.entries(extracted.parsed.attributes).map(([key, field]) => ({
            key, value: field.value, originalValue: field.value, label: field.label,
            confidence: field.confidence, sourceText: field.sourceText, page: field.page,
          })),
          ...(!data.payDate && options.emailDate ? [{
            key: "payDate", value: options.emailDate.toISOString(), originalValue: options.emailDate.toISOString(),
            label: "Email date (fallback)", confidence: "Low", sourceText: "Date from the email; check the actual pay date.", page: null,
          }] : []),
        ] },
      },
      include: { lines: true, fields: true },
      });
      await tx.payslipExtractionRevision.create({
        data: {
          payslipId: saved.id,
          version: 2,
          parserVersion: "template-aware-v2",
          payload: JSON.stringify({
            fields: extracted.parsed.fields,
            attributes: extracted.parsed.attributes,
            lines: extracted.parsed.lines,
            values: data,
          }),
        },
      });
      if (options.attachmentId) await tx.attachment.update({ where: { id: options.attachmentId }, data: { status: "imported", error: null } });
      return saved;
    });
    return { payslip, duplicate: false, ocrUsed: extracted.ocrUsed };
  } catch (error) {
    if (owned) await removeOriginal(storedFilename);
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      const duplicate = await prisma.payslip.findUnique({ where: { contentHash: hash }, include: { lines: true, fields: true } });
      if (duplicate) return { payslip: duplicate, duplicate: true, ocrUsed: extracted.ocrUsed };
    }
    throw error;
  }
}

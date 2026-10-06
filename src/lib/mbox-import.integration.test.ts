import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFile, readdir, unlink, rmdir, stat } from "node:fs/promises";
import path from "node:path";
import { processMbox, unlockMbox } from "./mbox-import";
import { prisma } from "./prisma";
import { sampleEmail, samplePdf } from "./test-fixtures";
import { contentHash } from "./documents";

const fixture = await vi.hoisted(async () => {
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  return { directory: await fs.mkdtemp(path.join(os.tmpdir(), "payslip-mbox-test-")) };
});
vi.mock("./prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${fixture.directory.replaceAll("\\", "/")}/test.db` }) };
});
vi.mock("./documents", async (importOriginal) => {
  const original = await importOriginal<typeof import("./documents")>();
  const { unlink } = await import("node:fs/promises");
  const path = await import("node:path");
  return {
    ...original,
    originalsDirectory: fixture.directory,
    removeOriginal: async (name: string) => {
      try { await unlink(path.join(fixture.directory, path.basename(name))); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    },
  };
});

beforeAll(() => {
  execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:${fixture.directory.replaceAll("\\", "/")}/test.db`, PRISMA_HIDE_UPDATE_MESSAGE: "1" },
    stdio: "pipe",
  });
});
afterAll(async () => {
  await prisma.$disconnect();
  for (const filename of await readdir(fixture.directory)) await unlink(path.join(fixture.directory, filename));
  await rmdir(fixture.directory);
});

describe("MBOX import with isolated SQLite and real PDF.js", () => {
  it("deduplicates attachments, preserves metadata, skips malformed mail and retries encrypted PDFs", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const source = path.join(fixture.directory, "fixture.mbox");
    const pdf = samplePdf();
    const protectedPdf = samplePdf("1234");
    await writeFile(source, Buffer.concat([
      sampleEmail([], "Ordinary email"),
      sampleEmail([{ filename: "../../payslip.pdf", type: "application/pdf", content: pdf }]),
      sampleEmail([{ filename: "renamed.pdf", type: "application/pdf", content: pdf }]),
      sampleEmail([{ filename: "protected.pdf", type: "application/pdf", content: protectedPdf }]),
      Buffer.from("From sender date\nthis is a malformed email\n"),
    ]));
    await prisma.mboxImport.create({ data: { id, filename: ".Payslip.mbox", expectedBytes: 1, status: "processing" } });
    const updates: number[] = [];
    const result = await processMbox(id, source, (update) => updates.push(update.emailsScanned));
    expect(result).toMatchObject({
      status: "complete", emailsScanned: 5, payslipEmailsFound: 3,
      attachmentsFound: 3, duplicatesSkipped: 1, emailsSkipped: 2, malformedEmails: 1,
    });
    expect(updates.at(-1)).toBe(5);
    const attachments = result!.emails.flatMap((email) => email.attachments);
    expect(attachments).toHaveLength(2);
    expect(attachments.find((attachment) => attachment.filename === "payslip.pdf")?.status).toBe("imported");
    expect(attachments.find((attachment) => attachment.filename === "protected.pdf")?.status).toBe("protected");
    expect(await prisma.payslip.count()).toBe(1);
    const record = await prisma.payslip.findFirstOrThrow({ include: { attachment: { include: { email: true } }, fields: true, extractionRevisions: true } });
    expect(record.extractionVersion).toBe(2);
    expect(record.extractionRevisions).toHaveLength(1);
    expect(record.extractionRevisions[0].parserVersion).toBe("template-aware-v2");
    expect(record.contentHash).toBe(contentHash(pdf));
    expect(record.grossPay).toBe(2100);
    expect(record.payDate?.toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect(record.fields.find((field) => field.key === "payDate")?.confidence).toBe("Low");
    expect(record.attachment?.email.subject).toBe("Monthly payslip");
    const wrong = await unlockMbox(id, "incorrect");
    expect(wrong.unlocked).toBe(0);
    expect(wrong.result!.emails.flatMap((email) => email.attachments).find((attachment) => attachment.status === "protected")?.error).toContain("didn't unlock");
    const correct = await unlockMbox(id, "1234");
    expect(correct.unlocked).toBe(1);
    expect(await prisma.payslip.count()).toBe(2);
    expect(correct.result!.emails.flatMap((email) => email.attachments).every((attachment) => attachment.status === "imported")).toBe(true);
    const recovered = attachments.find((attachment) => attachment.filename === "payslip.pdf")!;
    await prisma.attachment.update({ where: { id: recovered.id }, data: { status: "pending" } });
    const second = "00000000-0000-4000-8000-000000000002";
    await prisma.mboxImport.create({ data: { id: second, filename: "repeat.mbox", expectedBytes: 1, status: "processing" } });
    const repeated = await processMbox(second, source, () => undefined);
    expect(repeated?.duplicatesSkipped).toBe(3);
    expect(await prisma.payslip.count()).toBe(2);
    expect((await prisma.attachment.findUniqueOrThrow({ where: { id: recovered.id } })).status).toBe("imported");
    expect((await stat(path.join(fixture.directory, recovered.storedFilename))).size).toBe(pdf.length);
  });
  it("reports empty MBOX and corrupt framing without a success-shaped fallback", async () => {
    const source = path.join(fixture.directory, "empty.mbox");
    await writeFile(source, "");
    const id = "00000000-0000-4000-8000-000000000003";
    await prisma.mboxImport.create({ data: { id, filename: "empty.mbox", expectedBytes: 0, status: "processing" } });
    expect(await processMbox(id, source, () => undefined)).toMatchObject({ emailsScanned: 0, attachmentsFound: 0, error: "The MBOX was read, but no payslip attachments were found." });
    await writeFile(source, "corrupted file");
    const corrupt = "00000000-0000-4000-8000-000000000004";
    await prisma.mboxImport.create({ data: { id: corrupt, filename: "bad.mbox", expectedBytes: 1, status: "processing" } });
    expect(await processMbox(corrupt, source, () => undefined)).toMatchObject({ status: "error", error: "That MBOX couldn't be read. It may be incomplete or corrupted." });
  });
});

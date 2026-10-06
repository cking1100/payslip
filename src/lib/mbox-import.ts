import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { contentHash, documentType, importDocument, indexExistingDocuments, originalsDirectory, removeOriginal } from "./documents";
import { InvalidPinError, NeedsPinError } from "./extract";
import { maxAttachments, mboxMessages, parseMailMessage } from "./mbox";

export type MboxProgress = {
  emailsScanned: number; payslipEmailsFound: number; attachmentsFound: number;
  duplicatesSkipped: number; emailsSkipped: number; malformedEmails: number;
  stage: string;
};

export async function getMboxResult(id: string) {
  return prisma.mboxImport.findUnique({
    where: { id },
    include: { emails: { include: { attachments: { include: { payslip: { select: { id: true, payDate: true } } } } } } },
  });
}

async function analyseAttachment(id: string, pin?: string): Promise<"imported" | "protected" | "error" | "duplicate"> {
  const attachment = await prisma.attachment.findUniqueOrThrow({ where: { id }, include: { email: true } });
  if (attachment.status === "imported") return "imported";
  try {
    const result = await importDocument(await readFile(path.join(originalsDirectory, path.basename(attachment.storedFilename))), attachment.filename, {
      pin, attachmentId: id, storedFilename: attachment.storedFilename, emailDate: attachment.email.emailDate,
    });
    if (result.duplicate) {
      if (result.payslip.attachmentId === id || result.payslip.storedFilename === attachment.storedFilename) {
        await prisma.attachment.update({ where: { id }, data: { status: "imported", error: null } });
        return "imported";
      }
      await removeOriginal(attachment.storedFilename);
      await prisma.attachment.delete({ where: { id } });
      return "duplicate";
    }
    await prisma.attachment.update({ where: { id }, data: { status: "imported", error: null } });
    return "imported";
  } catch (error) {
    const protectedPdf = error instanceof NeedsPinError || error instanceof InvalidPinError;
    const message = protectedPdf
      ? error instanceof InvalidPinError ? "That PIN didn't unlock this payslip." : "Password protected"
      : "This attachment couldn't be analysed. It may be damaged or have an unsupported payslip layout.";
    await prisma.attachment.update({ where: { id }, data: { status: protectedPdf ? "protected" : "error", error: message } });
    return protectedPdf ? "protected" : "error";
  }
}

export async function processMbox(id: string, filename: string, emit: (progress: MboxProgress) => void) {
  const counters: MboxProgress = {
    emailsScanned: 0, payslipEmailsFound: 0, attachmentsFound: 0,
    duplicatesSkipped: 0, emailsSkipped: 0, malformedEmails: 0, stage: "Reading Gmail export…",
  };
  let lastUpdate = 0;
  const report = async (force = false) => {
    if (!force && Date.now() - lastUpdate < 300) return;
    lastUpdate = Date.now();
    await prisma.mboxImport.update({ where: { id }, data: {
      emailsScanned: counters.emailsScanned, payslipEmailsFound: counters.payslipEmailsFound,
      attachmentsFound: counters.attachmentsFound, duplicatesSkipped: counters.duplicatesSkipped,
      emailsSkipped: counters.emailsSkipped, malformedEmails: counters.malformedEmails,
    } });
    emit({ ...counters });
  };
  const source = createReadStream(filename, { highWaterMark: 64 * 1024 });
  try {
    await report(true);
    await indexExistingDocuments();
    await mkdir(originalsDirectory, { recursive: true });
    for await (const message of mboxMessages(source)) {
      counters.emailsScanned++;
      let mail;
      try {
        mail = await parseMailMessage(message);
      } catch {
        counters.malformedEmails++;
        counters.emailsSkipped++;
        await report();
        continue;
      }
      if (!mail.documents.length) {
        counters.emailsSkipped++;
        await report();
        continue;
      }
      counters.payslipEmailsFound++;
      const email = await prisma.email.create({ data: { mboxImportId: id, sender: mail.sender, recipient: mail.recipient, subject: mail.subject, emailDate: mail.emailDate } });
      for (const document of mail.documents) {
        counters.attachmentsFound++;
        if (counters.attachmentsFound > maxAttachments) throw new Error("This MBOX contains more than 10,000 candidate attachments. Split it into smaller exports.");
        const sha256 = contentHash(document.content);
        const previousAttachment = await prisma.attachment.findUnique({ where: { sha256 } });
        if (previousAttachment || await prisma.payslip.findUnique({ where: { contentHash: sha256 } })) {
          if (previousAttachment?.status === "pending") await analyseAttachment(previousAttachment.id);
          counters.duplicatesSkipped++;
          continue;
        }
        const attachmentId = randomUUID();
        const type = documentType(document.content);
        const storedFilename = document.error ? "" : `${attachmentId}${type!.extension}`;
        if (storedFilename) await writeFile(path.join(originalsDirectory, storedFilename), document.content, { flag: "wx" });
        try {
          await prisma.attachment.create({ data: {
            id: attachmentId, emailId: email.id, filename: document.filename, mimeType: document.mimeType,
            size: document.content.length, sha256, storedFilename,
            status: document.error ? "error" : "pending", error: document.error,
          } });
        } catch (error) {
          if (storedFilename) await removeOriginal(storedFilename);
          if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
            counters.duplicatesSkipped++;
            continue;
          }
          throw error;
        }
        if (!document.error) {
          counters.stage = "Analysing payslips…";
          await report(true);
          const result = await analyseAttachment(attachmentId);
          if (result === "duplicate") counters.duplicatesSkipped++;
        }
      }
      counters.stage = "Reading Gmail export…";
      await report();
    }
    counters.stage = "MBOX processed";
    await report(true);
    const noDocuments = !counters.attachmentsFound;
    await prisma.mboxImport.update({ where: { id }, data: {
      status: "complete",
      error: noDocuments ? "The MBOX was read, but no payslip attachments were found." : null,
    } });
    return getMboxResult(id);
  } catch (error) {
    await report(true);
    await prisma.mboxImport.update({ where: { id }, data: {
      status: "error", error: error instanceof Error && /^(?:That MBOX|The MBOX|This MBOX)/.test(error.message)
        ? error.message : "Something went wrong while extracting the email attachments.",
    } });
    return getMboxResult(id);
  } finally {
    source.destroy();
  }
}

export async function unlockMbox(id: string, pin: string, attachmentId?: string) {
  const attachments = await prisma.attachment.findMany({
    where: { email: { mboxImportId: id }, status: "protected", ...(attachmentId ? { id: attachmentId } : {}) },
  });
  let unlocked = 0;
  let duplicates = 0;
  for (const attachment of attachments) {
    const result = await analyseAttachment(attachment.id, pin);
    if (result === "imported") unlocked++;
    if (result === "duplicate") duplicates++;
  }
  if (duplicates) await prisma.mboxImport.update({ where: { id }, data: { duplicatesSkipped: { increment: duplicates } } });
  return { unlocked, result: await getMboxResult(id) };
}

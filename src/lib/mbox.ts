import { simpleParser } from "mailparser";
import { documentType, maxDocumentBytes, safeFilename, safeText } from "./documents";

export const maxMboxBytes = 5 * 1024 ** 3;
export const maxMessageBytes = 32 * 1024 ** 2;
export const maxAttachments = 10000;
const payWords = /\b(?:payslip|pay[\s_-]+slip|payroll|salary|wages?|payment|pay[\s_-]+statement)(?:\b|(?=[\d_]))/i;

export type MailDocument = {
  filename: string;
  mimeType: string;
  content: Buffer;
  error?: string;
};
export type MailMessage = {
  sender: string;
  recipient: string;
  subject: string;
  emailDate: Date | null;
  documents: MailDocument[];
};

// Bound memory by a single message, never by the size of the mailbox.
export async function* mboxMessages(source: AsyncIterable<Uint8Array>, limit = maxMessageBytes): AsyncGenerator<Buffer> {
  let pending = Buffer.alloc(0);
  let parts: Buffer[] = [];
  let bytes = 0;
  let started = false;
  for await (const chunk of source) {
    pending = Buffer.concat([pending, chunk]);
    let newline: number;
    while ((newline = pending.indexOf(10)) !== -1) {
      const line = pending.subarray(0, newline + 1);
      pending = pending.subarray(newline + 1);
      if (line.subarray(0, 5).toString("ascii") === "From ") {
        if (started) yield Buffer.concat(parts, bytes);
        started = true;
        parts = [];
        bytes = 0;
      } else {
        if (!started) {
          if (line.toString("ascii").trim()) throw new Error("That MBOX couldn't be read. It may be incomplete or corrupted.");
          continue;
        }
        const unescaped = /^>+From /.test(line.subarray(0, 64).toString("ascii")) ? line.subarray(1) : line;
        bytes += unescaped.length;
        if (bytes > limit) throw new Error("The MBOX contains an email too large to process safely (32 MB limit per email).");
        // Copy to avoid retaining an entire input chunk for a tiny line.
        parts.push(Buffer.from(unescaped));
        if (parts.length > 200000) throw new Error("The MBOX contains an email with too many lines to process safely.");
      }
    }
    if (pending.length + bytes > limit) throw new Error("The MBOX contains an email too large to process safely (32 MB limit per email).");
  }
  if (pending.length) {
    if (!started && pending.toString("ascii").startsWith("From ")) started = true;
    else if (!started && pending.toString("ascii").trim()) throw new Error("That MBOX couldn't be read. It may be incomplete or corrupted.");
    else if (started) { parts.push(pending); bytes += pending.length; }
  }
  if (started) yield Buffer.concat(parts, bytes);
}

export async function parseMailMessage(message: Buffer): Promise<MailMessage> {
  if (!message.length || !/^(?:[\w-]+):/m.test(message.subarray(0, 8192).toString("utf8"))) {
    throw new Error("This email has missing or malformed headers.");
  }
  const mail = await simpleParser(message, { skipHtmlToText: true, skipTextToHtml: true, skipImageLinks: true });
  const sender = safeText(mail.from?.text, 300);
  const recipient = safeText(Array.isArray(mail.to) ? mail.to.map((address) => address.text).join(", ") : mail.to?.text, 300);
  const subject = safeText(mail.subject, 300);
  const bodyText = mail.text ?? (typeof mail.html === "string" ? mail.html.slice(0, 64000).replace(/<[^>]*>/g, " ") : "");
  const context = `${subject} ${sender} ${bodyText.slice(0, 64000)}`;
  const documents: MailDocument[] = [];
  for (const attachment of mail.attachments) {
    const filename = safeFilename(attachment.filename ?? "attachment");
    const claimedDocument = /\.(pdf|png|jpe?g)$/i.test(filename) || /^(?:application\/pdf|image\/(?:png|jpeg))$/i.test(attachment.contentType);
    const type = documentType(attachment.content);
    const isPdf = type?.extension === ".pdf" || /\.pdf$/i.test(filename) || attachment.contentType === "application/pdf";
    if (!isPdf && !(payWords.test(`${context} ${filename}`) && (type || claimedDocument))) continue;
    if (!type && !claimedDocument) continue;
    documents.push({
      filename,
      mimeType: type?.mimeType ?? safeText(attachment.contentType, 100),
      content: attachment.content,
      error: attachment.content.length > maxDocumentBytes
        ? "This payslip attachment exceeds the 20 MB document limit."
        : !type ? "The attachment's contents aren't a valid PDF, PNG or JPG." : undefined,
    });
  }
  return {
    sender, recipient, subject,
    emailDate: mail.date && Number.isFinite(mail.date.getTime()) ? mail.date : null,
    documents,
  };
}

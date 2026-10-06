import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mboxMessages, parseMailMessage } from "./mbox";
import { sampleEmail, samplePdf } from "./test-fixtures";
import { extractPayslip, InvalidPinError, NeedsPinError } from "./extract";

async function messages(input: Buffer, chunkSize = 17) {
  async function* chunks() {
    for (let offset = 0; offset < input.length; offset += chunkSize) yield input.subarray(offset, offset + chunkSize);
  }
  const result: Buffer[] = [];
  for await (const message of mboxMessages(chunks())) result.push(message);
  return result;
}

describe("streaming Gmail MBOX parsing", () => {
  it("handles an empty MBOX without inventing emails or attachments", async () => {
    expect(await messages(Buffer.alloc(0))).toEqual([]);
  });
  it("skips ordinary emails without attachments", async () => {
    const [message] = await messages(sampleEmail([], "Dinner tonight"));
    expect((await parseMailMessage(message)).documents).toEqual([]);
  });
  it("extracts one PDF even without payslip wording", async () => {
    const [message] = await messages(sampleEmail([{ filename: "statement.pdf", type: "application/pdf", content: samplePdf() }], "Your document"));
    const mail = await parseMailMessage(message);
    expect(mail.documents).toHaveLength(1);
    expect(mail.documents[0].content).toEqual(samplePdf());
    expect(mail.subject).toBe("Your document");
    expect(mail.sender).toContain("fixture@example.test");
    expect(mail.emailDate?.toISOString()).toBe("2026-10-03T10:00:00.000Z");
  });
  it("extracts multiple PDFs and messages with CRLF and tiny chunks", async () => {
    const email = sampleEmail([
      { filename: "one.pdf", type: "application/pdf", content: samplePdf() },
      { filename: "two.pdf", type: "application/octet-stream", content: samplePdf("1234") },
    ]);
    const parsed = await messages(Buffer.from(Buffer.concat([email, email]).toString().replace(/\n/g, "\r\n")), 7);
    expect(parsed).toHaveLength(2);
    expect((await parseMailMessage(parsed[0])).documents).toHaveLength(2);
  });
  it("recognises image payslips while ignoring unrelated inline images", async () => {
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    const [message] = await messages(sampleEmail([{ filename: "pay slip.png", type: "image/png", content: png }]));
    expect((await parseMailMessage(message)).documents[0].mimeType).toBe("image/png");
    const [ordinary] = await messages(Buffer.from(sampleEmail([{ filename: "logo.png", type: "image/png", content: png }], "Holiday photos").toString().replace("Payroll <", "Friend <")));
    expect((await parseMailMessage(ordinary)).documents).toHaveLength(0);
    const [numericName] = await messages(Buffer.from(sampleEmail([{ filename: "Payslip2026.png", type: "image/png", content: png }], "Document").toString().replace("Payroll <", "Friend <")));
    expect((await parseMailMessage(numericName)).documents).toHaveLength(1);
    const htmlEmail = sampleEmail([{ filename: "scan.png", type: "image/png", content: png }], "Document").toString()
      .replace("Payroll <", "Friend <").replace("Content-Type: text/plain;", "Content-Type: text/html;")
      .replace("Your monthly statement is attached.", "<p>Your pay statement is ready.</p>");
    const [htmlMessage] = await messages(Buffer.from(htmlEmail));
    expect((await parseMailMessage(htmlMessage)).documents).toHaveLength(1);
  });
  it("preserves identical attachment bytes for SHA-256 duplicate detection", async () => {
    const [message] = await messages(sampleEmail([
      { filename: "first.pdf", type: "application/pdf", content: samplePdf() },
      { filename: "renamed.pdf", type: "application/pdf", content: samplePdf() },
    ]));
    const docs = (await parseMailMessage(message)).documents;
    const hash = (buffer: Buffer) => createHash("sha256").update(buffer).digest("hex");
    expect(hash(docs[0].content)).toBe(hash(docs[1].content));
  });
  it("passes a real encrypted PDF to the existing PIN pipeline", async () => {
    const [message] = await messages(sampleEmail([{ filename: "protected.pdf", type: "application/pdf", content: samplePdf("1234") }]));
    const pdf = (await parseMailMessage(message)).documents[0].content;
    await expect(extractPayslip(pdf, ".pdf")).rejects.toBeInstanceOf(NeedsPinError);
    await expect(extractPayslip(pdf, ".pdf", "incorrect")).rejects.toBeInstanceOf(InvalidPinError);
    const result = await extractPayslip(pdf, ".pdf", "1234");
    expect(result.parsed.fields.grossPay.amount).toBe(2100);
  });
  it("reports malformed messages and corrupt mailbox framing", async () => {
    await expect(parseMailMessage(Buffer.from("not an email"))).rejects.toThrow("malformed headers");
    await expect(messages(Buffer.from("a damaged mailbox"))).rejects.toThrow("incomplete or corrupted");
    const parsed = await messages(Buffer.concat([Buffer.from("From bad@example.test date\nmalformed message\n"), sampleEmail()]));
    expect(parsed).toHaveLength(2);
    await expect(parseMailMessage(parsed[0])).rejects.toThrow("malformed headers");
    expect((await parseMailMessage(parsed[1])).documents).toHaveLength(0);
  });
  it("sanitises unusual attachment paths and checks signatures rather than MIME alone", async () => {
    const [message] = await messages(sampleEmail([
      { filename: "../../pay slip ü.pdf", type: "application/octet-stream", content: samplePdf() },
      { filename: "fake.pdf", type: "application/pdf", content: Buffer.from("<script>unsafe</script>") },
    ]));
    const docs = (await parseMailMessage(message)).documents;
    expect(docs[0].filename).toBe("pay slip ü.pdf");
    expect(docs[0].mimeType).toBe("application/pdf");
    expect(docs[1].error).toContain("aren't a valid");
  });
  it("yields before consuming the entire mailbox and bounds single-message memory", async () => {
    const email = sampleEmail();
    let chunksRead = 0;
    async function* largeMailbox() {
      for (let index = 0; index < 10000; index++) { chunksRead++; yield email; }
    }
    const iterator = mboxMessages(largeMailbox());
    await iterator.next();
    expect(chunksRead).toBeLessThan(4);
    await iterator.return(undefined);
    const oversized = Readable.from([Buffer.from(`From sender date\nSubject: payslip\n\n${"x".repeat(1025)}`)]);
    await expect((async () => { for await (const message of mboxMessages(oversized, 1024)) void message; })()).rejects.toThrow("too large");
  });
  it("unescapes mboxrd From lines inside bodies without splitting messages", async () => {
    const input = Buffer.from("From sender date\nSubject: payslip\nContent-Type: text/plain\n\n>From a body line\n>>From nested\n");
    const parsed = await messages(input);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].toString()).toContain("\nFrom a body line\n>From nested\n");
  });
});

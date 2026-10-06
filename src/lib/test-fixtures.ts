import { createHash } from "node:crypto";

function rc4(key: Buffer, input: Buffer): Buffer {
  const state = Array.from({ length: 256 }, (_, index) => index);
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
  }
  let i = 0;
  j = 0;
  return Buffer.from([...input].map((byte) => {
    i = (i + 1) % 256;
    j = (j + state[i]) % 256;
    [state[i], state[j]] = [state[j], state[i]];
    return byte ^ state[(state[i] + state[j]) % 256];
  }));
}

export function samplePdf(password?: string, extraLines: string[] = []): Buffer {
  const extra = extraLines.map((line) => `0 -35 Td (${line.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)")}) Tj`).join(" ");
  const text = Buffer.from(`BT /F1 18 Tf 72 720 Td (Gross Pay 2100.00) Tj 0 -35 Td (Net Pay 1780.00) Tj 0 -35 Td (PAYE Tax 200.00) Tj 0 -35 Td (National Insurance 70.00) Tj ${extra} ET`);
  const id = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const padded = (value: string) => Buffer.concat([Buffer.from(value), padding]).subarray(0, 32);
  const md5 = (buffer: Buffer) => createHash("md5").update(buffer).digest();
  const owner = rc4(md5(padded("fixture-owner")).subarray(0, 5), padded(password ?? ""));
  const permission = Buffer.alloc(4);
  permission.writeInt32LE(-4);
  const fileKey = md5(Buffer.concat([padded(password ?? ""), owner, permission, id])).subarray(0, 5);
  const user = rc4(fileKey, padding);
  const streamKey = md5(Buffer.concat([fileKey, Buffer.from([5, 0, 0, 0, 0])])).subarray(0, 10);
  const stream = password ? rc4(streamKey, text) : text;
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>"),
    Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"),
    Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`), stream, Buffer.from("\nendstream")]),
  ];
  if (password) objects.push(Buffer.from(`<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>`));
  let pdf = Buffer.from("%PDF-1.4\n");
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf = Buffer.concat([pdf, Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
  });
  const xref = pdf.length;
  const trailer = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R ${password ? "/Encrypt 6 0 R" : ""} /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.concat([pdf, Buffer.from(trailer)]);
}

export function sampleEmail(attachments: Array<{ filename: string; type: string; content: Buffer }> = [], subject = "Monthly payslip"): Buffer {
  const headers = [
    "From fixture@example.test Sat Oct 03 10:00:00 2026",
    "From: Payroll <fixture@example.test>",
    "To: Example <employee@example.test>",
    `Subject: ${subject}`,
    "Date: Sat, 3 Oct 2026 10:00:00 +0000",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="fixture-boundary"',
    "", "--fixture-boundary", "Content-Type: text/plain; charset=utf-8", "", "Your monthly statement is attached.",
  ];
  for (const attachment of attachments) headers.push(
    "--fixture-boundary",
    `Content-Type: ${attachment.type}`,
    `Content-Disposition: attachment; filename="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64", "",
    attachment.content.toString("base64").match(/.{1,76}/g)?.join("\n") ?? "",
  );
  headers.push("--fixture-boundary--", "");
  return Buffer.from(headers.join("\n"));
}

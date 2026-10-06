import { createCanvas } from "@napi-rs/canvas";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parsePayslip, type ParsedPayslip } from "./parser";
import { localDataDirectory } from "./local-data";

export class NeedsPinError extends Error {}
export class InvalidPinError extends Error {}

function isPasswordError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && error instanceof Error && (
    error.name === "PasswordException" || error.constructor.name === "PasswordException"
  ));
}

async function runOcr(images: Buffer[]): Promise<Array<{ text: string; confidence: number }>> {
  const cachePath = path.join(localDataDirectory, "tesseract");
  await mkdir(cachePath, { recursive: true });
  const worker = await createWorker("eng", 1, {
    langPath: path.join(process.cwd(), "node_modules", "@tesseract.js-data", "eng", "4.0.0_best_int"),
    cachePath,
    gzip: true,
  });
  try {
    const results: Array<{ text: string; confidence: number }> = [];
    for (const image of images) {
      const result = await worker.recognize(image);
      results.push({ text: result.data.text, confidence: result.data.confidence });
    }
    return results;
  } finally {
    await worker.terminate();
  }
}

function pdfTextByLines(items: Array<{ str?: string; transform?: number[] }>): string {
  const rows = new Map<number, Array<{ x: number; text: string }>>();
  for (const item of items) {
    if (!item.str?.trim() || !item.transform) continue;
    const y = Math.round(item.transform[5]);
    const row = rows.get(y) ?? [];
    row.push({ x: item.transform[4], text: item.str });
    rows.set(y, row);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) => row.sort((a, b) => a.x - b.x).map((item) => item.text).join("  "))
    .join("\n");
}

async function extractPdf(buffer: Buffer, pin?: string): Promise<Array<{ text: string; image?: Buffer }>> {
  let document;
  try {
    document = await getDocument({
      data: new Uint8Array(buffer),
      password: pin,
      isEvalSupported: false,
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    if (isPasswordError(error)) {
      if (pin) throw new InvalidPinError("That PIN didn't unlock this payslip.");
      throw new NeedsPinError("This PDF is protected and needs its PIN.");
    }
    throw new Error("We couldn't read this PDF. It may be damaged or protected by a password.");
  }

  try {
    if (document.numPages > 100) throw new Error("This PDF has more than 100 pages. Split it into smaller files and try again.");
    const pages: Array<{ text: string; image?: Buffer }> = [];
    for (let number = 1; number <= document.numPages; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      const text = pdfTextByLines(content.items as Array<{ str?: string; transform?: number[] }>);
      const result: { text: string; image?: Buffer } = { text };
      if (text.replace(/\s/g, "").length < 35) {
        const viewport = page.getViewport({ scale: 1.6 });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({ canvasContext: canvas.getContext("2d") as never, viewport }).promise;
        result.image = canvas.toBuffer("image/png");
      }
      pages.push(result);
    }
    return pages;
  } finally {
    await document.destroy();
  }
}

export async function extractPayslip(buffer: Buffer, extension: string, pin?: string): Promise<{ parsed: ParsedPayslip; ocrUsed: boolean }> {
  let ocrUsed = false;
  let pageTexts: Array<{ page: number; text: string; confidence?: number }>;
  if (extension === ".pdf") {
    const pages = await extractPdf(buffer, pin);
    const imagePages = pages.map((page, index) => page.image ? index : -1).filter((index) => index >= 0);
    const ocrResults = imagePages.length ? await runOcr(imagePages.map((index) => pages[index].image!)) : [];
    ocrUsed = ocrResults.length > 0;
    let resultIndex = 0;
    pageTexts = pages.map((page, index) => {
      if (page.image) {
        const result = ocrResults[resultIndex++];
        return { page: index + 1, text: result.text || page.text, confidence: result.confidence };
      }
      return { page: index + 1, text: page.text };
    });
    if (!pageTexts.some((page) => page.text.replace(/\s/g, "").length >= 35)) {
      throw new Error("This payslip doesn't contain enough readable text. Try a clearer scan or a digital PDF.");
    }
  } else {
    ocrUsed = true;
    const [result] = await runOcr([buffer]);
    pageTexts = [{ page: 1, text: result.text, confidence: result.confidence }];
  }

  const parsed: ParsedPayslip = { employer: null, employeeName: null, payDate: null, periodStart: null, periodEnd: null, attributes: {}, fields: {}, lines: [] };
  for (const page of pageTexts) {
    const result = parsePayslip(page.text, page.page, page.confidence);
    for (const [key, attribute] of Object.entries(result.attributes)) if (!parsed.attributes[key]) parsed.attributes[key] = attribute;
    for (const [key, field] of Object.entries(result.fields)) if (!parsed.fields[key]) parsed.fields[key] = field;
    parsed.lines.push(...result.lines);
    parsed.employer ??= result.employer;
    parsed.employeeName ??= result.employeeName;
    parsed.payDate ??= result.payDate;
    parsed.periodStart ??= result.periodStart;
    parsed.periodEnd ??= result.periodEnd;
  }
  if (!parsed.lines.length) {
    throw new Error(ocrUsed
      ? "We couldn't find readable pay details in this file. Try a clearer scan or a digital PDF."
      : "We couldn't read this payslip. It may be scanned or protected by a password.");
  }
  return { parsed, ocrUsed };
}

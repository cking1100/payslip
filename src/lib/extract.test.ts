import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { createWorker } from "tesseract.js";
import { extractPayslip, InvalidPinError, NeedsPinError } from "./extract";

vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument: vi.fn() }));
vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));
vi.mock("@napi-rs/canvas", () => ({
  createCanvas: () => ({ getContext: () => ({}), toBuffer: () => Buffer.from("rendered-page") }),
}));

describe("local document extraction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("identifies a protected PDF and distinguishes an incorrect PIN", async () => {
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.reject(Object.assign(new Error("password required"), { name: "PasswordException" })) } as never);
    await expect(extractPayslip(Buffer.from("%PDF"), ".pdf")).rejects.toBeInstanceOf(NeedsPinError);
    await expect(extractPayslip(Buffer.from("%PDF"), ".pdf", "wrong")).rejects.toBeInstanceOf(InvalidPinError);
  });

  it("uses local OCR for an image when no PDF text layer is available", async () => {
    vi.mocked(createWorker).mockResolvedValue({
      recognize: vi.fn().mockResolvedValue({ data: { text: "Gross Pay £1,200.00\nNet Pay £1,000.00", confidence: 48 } }),
      terminate: vi.fn(),
    } as never);
    const result = await extractPayslip(Buffer.from("local-image"), ".png");
    expect(result.ocrUsed).toBe(true);
    expect(result.parsed.fields.grossPay.amount).toBe(1200);
    expect(result.parsed.fields.grossPay.confidence).toBe("Low");
    expect(createWorker).toHaveBeenCalledOnce();
  });

  it("extracts digital PDF text without starting OCR", async () => {
    const page = {
      getTextContent: vi.fn().mockResolvedValue({
        items: [
          { str: "Gross Pay £1,500.00", transform: [1, 0, 0, 1, 10, 100] },
          { str: "Net Pay £1,230.00", transform: [1, 0, 0, 1, 10, 80] },
          { str: "PAYE Tax £100.00", transform: [1, 0, 0, 1, 10, 60] },
        ],
      }),
    };
    vi.mocked(getDocument).mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: vi.fn().mockResolvedValue(page), destroy: vi.fn() }) } as never);
    const result = await extractPayslip(Buffer.from("%PDF"), ".pdf");
    expect(result.ocrUsed).toBe(false);
    expect(result.parsed.fields.grossPay.amount).toBe(1500);
    expect(createWorker).not.toHaveBeenCalled();
  });
});

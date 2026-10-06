import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { InvalidPinError, NeedsPinError } from "@/lib/extract";
import { importDocument, indexExistingDocuments } from "@/lib/documents";
import { isLocalRequest } from "@/lib/local-request";
import { dataResponse } from "@/lib/data-operation";
import { DELETE as clearData } from "@/app/api/data/route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "This app only accepts requests from this computer." }, { status: 403 });
  const payslips = await prisma.payslip.findMany({ include: { lines: true, fields: true, attachment: { include: { email: true } } }, orderBy: [{ payDate: "desc" }, { importedAt: "desc" }] });
  return NextResponse.json(payslips);
}

export async function POST(request: NextRequest) {
  return dataResponse(() => upload(request));
}
async function upload(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "This app only accepts requests from this computer." }, { status: 403 });
  if (Number(request.headers.get("content-length")) > 21 * 1024 * 1024) {
    return NextResponse.json({ error: "Document uploads must be smaller than 20 MB. Use the Gmail import for MBOX files." }, { status: 413 });
  }
  try {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "Choose a PDF, PNG or JPG file." }, { status: 400 });
    if (!/\.(pdf|png|jpe?g)$/i.test(file.name)) return NextResponse.json({ error: "Please choose a PDF, PNG or JPG. Gmail exports use the MBOX importer." }, { status: 415 });
    const types = ["application/pdf", "application/octet-stream", "image/png", "image/jpeg", ""];
    if (!types.includes(file.type)) return NextResponse.json({ error: "The document's file type isn't supported." }, { status: 415 });
    if (!file.size || file.size > 20 * 1024 * 1024) return NextResponse.json({ error: "Document uploads must be smaller than 20 MB." }, { status: 413 });
    const pin = form.get("pin");
    if (pin !== null && typeof pin !== "string") return NextResponse.json({ error: "Enter a valid PIN." }, { status: 400 });
    await indexExistingDocuments();
    const result = await importDocument(Buffer.from(await file.arrayBuffer()), file.name, { pin: pin ?? undefined });
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof NeedsPinError) return NextResponse.json({ requiresPin: true, error: error.message }, { status: 423 });
    if (error instanceof InvalidPinError) return NextResponse.json({ error: error.message }, { status: 422 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "The document couldn't be read." }, { status: 422 });
  }
}

export async function DELETE(request: NextRequest) {
  return clearData(request);
}

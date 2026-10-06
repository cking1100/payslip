import { createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { NextRequest, NextResponse } from "next/server";
import { isLocalRequest } from "@/lib/local-request";
import { prisma } from "@/lib/prisma";
import { deleteTemporaryMbox, mboxPath } from "@/lib/mbox-storage";
import { getMboxResult, processMbox, unlockMbox } from "@/lib/mbox-import";
import { dataResponse, withDataOperation } from "@/lib/data-operation";

export const runtime = "nodejs";
export const maxDuration = 86400;
type Context = { params: Promise<{ id: string }> };

async function findImport(context: Context) {
  const { id } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return prisma.mboxImport.findUnique({ where: { id } });
}

export async function GET(request: NextRequest, context: Context) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Gmail imports are only available on this computer." }, { status: 403 });
  const item = await findImport(context);
  return item ? NextResponse.json(await getMboxResult(item.id)) : NextResponse.json({ error: "Gmail import not found." }, { status: 404 });
}

export async function PUT(request: NextRequest, context: Context) {
  return dataResponse(() => uploadChunk(request, context));
}
async function uploadChunk(request: NextRequest, context: Context) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Gmail imports are only available on this computer." }, { status: 403 });
  const item = await findImport(context);
  if (!item) return NextResponse.json({ error: "Gmail import not found." }, { status: 404 });
  const offset = Number(request.headers.get("x-upload-offset"));
  const length = Number(request.headers.get("content-length"));
  if (!request.body || !Number.isSafeInteger(offset) || offset !== item.uploadedBytes
    || !length || length > 4 * 1024 * 1024 || offset + length > item.expectedBytes) {
    return NextResponse.json({ error: "The Gmail upload was interrupted or the chunk was too large. Please choose the file again." }, { status: 400 });
  }
  const claimed = await prisma.mboxImport.updateMany({ where: { id: item.id, status: "uploading", uploadedBytes: offset }, data: { status: "writing" } });
  if (!claimed.count) return NextResponse.json({ error: "This upload is already busy or has finished." }, { status: 409 });
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > length || bytes > 4 * 1024 * 1024 ? new Error("Upload chunk exceeded its expected length.") : null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream<Uint8Array>), counter, createWriteStream(mboxPath(item.id), { flags: "a" }));
    if (bytes !== length) throw new Error("Upload chunk was incomplete.");
    await prisma.mboxImport.update({ where: { id: item.id }, data: { uploadedBytes: offset + bytes, status: "uploading" } });
    return NextResponse.json({ uploadedBytes: offset + bytes });
  } catch {
    await deleteTemporaryMbox(item.id);
    await prisma.mboxImport.update({ where: { id: item.id }, data: { status: "error", error: "The local MBOX upload was interrupted. Please choose the export again." } });
    return NextResponse.json({ error: "The local MBOX upload was interrupted. Please choose the export again." }, { status: 422 });
  }
}

export async function POST(request: NextRequest, context: Context) {
  return dataResponse(() => processOrUnlock(request, context));
}
async function processOrUnlock(request: NextRequest, context: Context) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Gmail imports are only available on this computer." }, { status: 403 });
  const item = await findImport(context);
  if (!item) return NextResponse.json({ error: "Gmail import not found." }, { status: 404 });
  const body: unknown = await request.json();
  if (body && typeof body === "object" && "pin" in body) {
    if (typeof body.pin !== "string" || !body.pin || body.pin.length > 256
      || ("attachmentId" in body && typeof body.attachmentId !== "string")) {
      return NextResponse.json({ error: "Enter a valid PIN and choose a protected payslip." }, { status: 400 });
    }
    const locked = await prisma.mboxImport.updateMany({ where: { id: item.id, status: { in: ["complete", "error"] } }, data: { status: "unlocking" } });
    if (!locked.count) return NextResponse.json({ error: "Wait for this import to finish before unlocking its payslips." }, { status: 409 });
    try {
      const unlocked = await unlockMbox(item.id, body.pin, "attachmentId" in body ? body.attachmentId as string : undefined);
      return NextResponse.json({ ...unlocked, result: unlocked.result ? { ...unlocked.result, status: item.status } : null });
    } finally {
      await prisma.mboxImport.update({ where: { id: item.id }, data: { status: item.status } });
    }
  }
  if (!body || typeof body !== "object" || !("process" in body) || body.process !== true || item.uploadedBytes !== item.expectedBytes) {
    return NextResponse.json({ error: "The MBOX upload isn't complete. Please choose the export again." }, { status: 400 });
  }
  const claimed = await prisma.mboxImport.updateMany({ where: { id: item.id, status: "uploading" }, data: { status: "processing" } });
  if (!claimed.count) return NextResponse.json({ error: "This Gmail import is already processing or has finished." }, { status: 409 });
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      await withDataOperation(async () => {
      const send = (data: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(`${JSON.stringify(data)}\n`)); };
      try {
        const result = await processMbox(item.id, mboxPath(item.id), (progress) => send({ progress }));
        await deleteTemporaryMbox(item.id);
        send({ result });
      } catch {
        await deleteTemporaryMbox(item.id);
        await prisma.mboxImport.update({ where: { id: item.id }, data: { status: "error", error: "Something went wrong while extracting the email attachments." } });
        send({ error: "Something went wrong while extracting the email attachments." });
      } finally {
        if (!cancelled) controller.close();
      }
      });
    },
    cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}

export async function DELETE(request: NextRequest, context: Context) {
  return dataResponse(() => cancelUpload(request, context));
}
async function cancelUpload(request: NextRequest, context: Context) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Gmail imports are only available on this computer." }, { status: 403 });
  const item = await findImport(context);
  if (!item) return NextResponse.json({ error: "Gmail import not found." }, { status: 404 });
  if (["processing", "writing", "unlocking"].includes(item.status)) return NextResponse.json({ error: "Wait for this Gmail import to finish." }, { status: 409 });
  await deleteTemporaryMbox(item.id);
  if (item.status === "uploading") await prisma.mboxImport.update({ where: { id: item.id }, data: { status: "error", error: "The Gmail upload was cancelled. Please choose the export again." } });
  return NextResponse.json({ deleted: true });
}

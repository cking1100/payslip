import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { safeFilename } from "@/lib/documents";
import { isLocalRequest } from "@/lib/local-request";
import { maxMboxBytes } from "@/lib/mbox";
import { deleteTemporaryMbox, mboxPath, prepareMboxStorage } from "@/lib/mbox-storage";
import { dataResponse } from "@/lib/data-operation";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Gmail imports are only available on this computer." }, { status: 403 });
  return NextResponse.json(await prisma.mboxImport.findMany({
    where: { status: { notIn: ["uploading", "writing"] } },
    orderBy: { importedAt: "desc" }, take: 10,
    include: { emails: { include: { attachments: { include: { payslip: { select: { id: true, payDate: true } } } } } } },
  }));
}

export async function POST(request: NextRequest) {
  return dataResponse(() => upload(request));
}
async function upload(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Gmail imports are only available on this computer." }, { status: 403 });
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || !("filename" in body) || !("size" in body)
    || typeof body.filename !== "string" || !/\.mbox$/i.test(body.filename)
    || typeof body.size !== "number" || !Number.isSafeInteger(body.size) || body.size < 0) {
    return NextResponse.json({ error: "Choose a valid Gmail Takeout .mbox file." }, { status: 400 });
  }
  if (body.size > maxMboxBytes) return NextResponse.json({ error: "The MBOX is too large to process safely. The limit is 5 GB; export a smaller Gmail label." }, { status: 413 });
  const expired = await prisma.mboxImport.findMany({
    where: { status: { in: ["uploading", "writing", "processing", "unlocking"] }, importedAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  for (const item of expired) {
    await deleteTemporaryMbox(item.id);
    await prisma.mboxImport.update({ where: { id: item.id }, data: { status: "error", error: "This interrupted Gmail import expired. Please choose the export again." } });
  }
  const id = randomUUID();
  await prepareMboxStorage();
  await writeFile(mboxPath(id), Buffer.alloc(0), { flag: "wx", mode: 0o600 });
  try {
    await prisma.mboxImport.create({ data: { id, filename: safeFilename(body.filename), expectedBytes: body.size } });
  } catch (error) {
    await deleteTemporaryMbox(id);
    throw error;
  }
  return NextResponse.json({ id, chunkBytes: 4 * 1024 * 1024 }, { status: 201 });
}

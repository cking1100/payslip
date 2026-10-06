import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { localDataDirectory } from "@/lib/local-data";
import { isLocalRequest } from "@/lib/local-request";
import { createDataManager, validDeleteConfirmation } from "@/lib/data-management";
import { DataBusyError, withExclusiveDataOperation } from "@/lib/data-operation";

export const runtime = "nodejs";
const databaseUrl = process.env.DATABASE_URL ?? "file:./dev.db";
const filename = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : "";
const manager = createDataManager(prisma, localDataDirectory, {
  databasePath: filename ? path.isAbsolute(filename) ? filename : path.resolve(process.cwd(), "prisma", filename) : undefined,
});
export async function GET(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Data management is only available on this computer." }, { status: 403 });
  try {
    return await withExclusiveDataOperation(async () => {
      await manager.recover();
      return NextResponse.json(await manager.counts(), { headers: {
        "Cache-Control": "no-store",
        ...(process.env.PAYSLIP_TEST_INSTANCE ? { "X-Payslip-Test-Instance": process.env.PAYSLIP_TEST_INSTANCE } : {}),
      } });
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof DataBusyError ? error.message : "Local storage couldn't be inspected safely. Check file permissions and try again." }, { status: error instanceof DataBusyError ? 409 : 500 });
  }
}
export async function DELETE(request: NextRequest) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "Data management is only available on this computer." }, { status: 403 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Type DELETE exactly and acknowledge that this cannot be undone." }, { status: 400 }); }
  if (!validDeleteConfirmation(body)) return NextResponse.json({ error: "Type DELETE exactly and acknowledge that this cannot be undone." }, { status: 400 });
  try { return await withExclusiveDataOperation(async () => NextResponse.json(await manager.clear(body))); } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Local data couldn't be cleared safely." }, { status: error instanceof DataBusyError ? 409 : 500 });
  }
}

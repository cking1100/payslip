import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { isLocalRequest } from "@/lib/local-request";
import { removeOriginal } from "@/lib/documents";
import { dataResponse } from "@/lib/data-operation";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "This app only accepts requests from this computer." }, { status: 403 });
  const { id } = await context.params;
  const payslip = await prisma.payslip.findUnique({ where: { id }, include: { lines: true, fields: true, attachment: { include: { email: true } } } });
  return payslip ? NextResponse.json(payslip) : NextResponse.json({ error: "Payslip not found." }, { status: 404 });
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return dataResponse(() => updatePayslip(request, context));
}
async function updatePayslip(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "This app only accepts requests from this computer." }, { status: 403 });
  const { id } = await context.params;
  const body: unknown = await request.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({ error: "Check the values and try again." }, { status: 400 });

  const allowedNumbers = ["grossPay", "netPay", "tax", "nationalInsurance", "pension", "studentLoan", "otherDeductions", "hoursWorked", "hourlyRate", "grossYtd", "taxYtd", "nationalInsuranceYtd", "pensionYtd", "netYtd"] as const;
  const allowedText = ["employer", "employeeName"] as const;
  const data: Record<string, unknown> = {};
  const changes: Array<{ field: string; value: string | number | null; label: string }> = [];
  const values = body as Record<string, unknown>;
  const editedLines = values.lines;
  if (editedLines !== undefined && (!Array.isArray(editedLines) || editedLines.some((line) => {
    if (!line || typeof line !== "object") return true;
    const item = line as Record<string, unknown>;
    return typeof item.id !== "string"
      || (item.amount !== null && (typeof item.amount !== "number" || !Number.isFinite(item.amount)))
      || (item.ytdAmount !== null && (typeof item.ytdAmount !== "number" || !Number.isFinite(item.ytdAmount)))
      || typeof item.label !== "string" || item.label.length > 180;
  }))) return NextResponse.json({ error: "Check the earnings and deduction values and try again." }, { status: 400 });
  for (const key of allowedNumbers) {
    if (key in values) {
      const value = values[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value))) return NextResponse.json({ error: "Enter a valid number for each value." }, { status: 400 });
      data[key] = value;
      changes.push({ field: key, value, label: key });
    }
  }
  for (const key of allowedText) {
    if (key in values) {
      if (values[key] !== null && typeof values[key] !== "string") return NextResponse.json({ error: "Enter valid text." }, { status: 400 });
      data[key] = typeof values[key] === "string" ? values[key].slice(0, 180) : null;
      changes.push({ field: key, value: typeof values[key] === "string" ? values[key] as string : null, label: key });
    }
  }
  for (const key of ["payDate", "periodStart", "periodEnd"] as const) {
    if (key in values) {
      const value = values[key];
      const date = typeof value === "string" ? new Date(value) : null;
      if (value !== null && (!date || Number.isNaN(date.getTime()))) return NextResponse.json({ error: "Enter a valid date." }, { status: 400 });
      data[key] = date;
      changes.push({ field: key, value: date?.toISOString() ?? null, label: key });
    }
  }

  try {
    const existing = await prisma.payslip.findUnique({ where: { id }, include: { lines: true } });
    if (!existing) return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
    const original = existing as unknown as Record<string, unknown>;
    const manualChanges = changes.filter(({ field, value }) => {
      const current = original[field];
      const stored = current instanceof Date ? current.toISOString() : current;
      return stored !== value;
    });
    await prisma.payslip.update({ where: { id }, data, include: { lines: true, fields: true } });
    await Promise.all(manualChanges.map(({ field, value, label }) => prisma.payslipField.upsert({
      where: { payslipId_key: { payslipId: id, key: field } },
      update: { manuallyCorrected: true, value: value === null ? null : String(value) },
      create: {
        payslipId: id,
        key: field,
        value: value === null ? null : String(value),
        originalValue: null,
        label,
        confidence: "Low",
        manuallyCorrected: true,
      },
    })));
    if (Array.isArray(editedLines)) {
      for (const value of editedLines) {
        const line = value as { id: string; amount: number | null; ytdAmount: number | null; label: string };
        const original = await prisma.payslipLine.findFirst({ where: { id: line.id, payslipId: id } });
        if (original && (original.label !== line.label || original.amount !== line.amount || original.ytdAmount !== line.ytdAmount)) await prisma.payslipLine.update({
          where: { id: original.id },
          data: {
            label: line.label,
            amount: line.amount,
            ytdAmount: line.ytdAmount,
            manuallyCorrected: true,
            originalAmount: original.originalAmount ?? original.amount,
          },
        });
      }
    }
    return NextResponse.json(await prisma.payslip.findUnique({ where: { id }, include: { lines: true, fields: true, attachment: { include: { email: true } } } }));
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "P2025") return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
    throw error;
  }
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return dataResponse(() => deletePayslip(request, context));
}
async function deletePayslip(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (!isLocalRequest(request)) return NextResponse.json({ error: "This app only accepts requests from this computer." }, { status: 403 });
  const { id } = await context.params;
  const payslip = await prisma.payslip.findUnique({ where: { id } });
  if (!payslip) return NextResponse.json({ error: "Payslip not found." }, { status: 404 });
  if (payslip.storedFilename) await removeOriginal(payslip.storedFilename);
  await prisma.payslip.delete({ where: { id } });
  if (payslip.attachmentId) await prisma.attachment.delete({ where: { id: payslip.attachmentId } });
  return NextResponse.json({ deleted: true });
}

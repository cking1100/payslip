import { NextResponse } from "next/server";

const globalData = globalThis as typeof globalThis & { payslipDataOperations?: { active: number; clearing: boolean } };
const state = globalData.payslipDataOperations ??= { active: 0, clearing: false };
export class DataBusyError extends Error {
  constructor() { super("Local data is busy. Wait for imports or deletion to finish, then try again."); }
}
export async function withDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (state.clearing) throw new DataBusyError();
  state.active++;
  try { return await operation(); } finally { state.active--; }
}
export async function withExclusiveDataOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (state.clearing || state.active) throw new DataBusyError();
  state.clearing = true;
  try { return await operation(); } finally { state.clearing = false; }
}
export async function dataResponse(operation: () => Promise<Response>): Promise<Response> {
  try { return await withDataOperation(operation); } catch (error) {
    if (error instanceof DataBusyError) return NextResponse.json({ error: error.message }, { status: 409 });
    throw error;
  }
}

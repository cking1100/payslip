import { mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import { localDataDirectory } from "./local-data";

export const mboxTempDirectory = path.join(localDataDirectory, "temp");

export function mboxPath(id: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("Invalid Gmail import identifier.");
  return path.join(mboxTempDirectory, `${id}.mbox`);
}

export async function prepareMboxStorage() {
  await mkdir(mboxTempDirectory, { recursive: true });
}

export async function deleteTemporaryMbox(id: string) {
  try { await unlink(mboxPath(id)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

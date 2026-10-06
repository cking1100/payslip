import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { PrismaClient } from "@prisma/client";
import { DataBusyError } from "./data-operation";

const managedDirectories = ["originals", "temp", "previews", "thumbnails", "cache", "caches", "uploads", "payslips", "statistics"] as const;
const quarantinePattern = /^\.clear-[0-9a-f-]{36}$/i;
export type DataCounts = {
  payslips: number; emails: number; attachments: number; imports: number; originals: number;
  documentBytes: number; temporaryBytes: number; databaseBytes: number; storageBytes: number;
};
export function validDeleteConfirmation(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && "confirmation" in value && value.confirmation === "DELETE"
    && "acknowledged" in value && value.acknowledged === true);
}
function notFound(error: unknown) { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT"); }

async function inventory(directory: string): Promise<{ files: number; bytes: number }> {
  let info;
  try { info = await lstat(directory); } catch (error) { if (notFound(error)) return { files: 0, bytes: 0 }; throw error; }
  if (info.isSymbolicLink()) return { files: 0, bytes: 0 };
  if (!info.isDirectory()) return { files: 1, bytes: info.size };
  let files = 0, bytes = 0;
  for (const name of await readdir(directory)) {
    const child = await inventory(path.join(directory, name)); files += child.files; bytes += child.bytes;
  }
  return { files, bytes };
}
async function removeControlledTree(directory: string): Promise<void> {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) { await unlink(directory); return; }
  for (const name of await readdir(directory)) await removeControlledTree(path.join(directory, name));
  await rmdir(directory);
}

export function createDataManager(db: PrismaClient, root: string, options: {
  databasePath?: string; move?: typeof rename; remove?: typeof removeControlledTree;
  beforeCommit?: () => Promise<void>;
} = {}) {
  root = path.resolve(root);
  if ([process.cwd(), os.homedir(), path.parse(root).root].some((unsafe) => path.resolve(unsafe) === root)) throw new Error("The app data directory must be a dedicated storage directory.");
  const move = options.move ?? rename, remove = options.remove ?? removeControlledTree;
  async function recover() {
    let names: string[];
    try { names = await readdir(root); } catch (error) { if (notFound(error)) return; throw error; }
    for (const name of names.filter((name) => quarantinePattern.test(name))) {
      const directory = path.join(root, name);
      if ((await lstat(directory)).isSymbolicLink()) throw new Error("A cleanup recovery path is unsafe. No files were removed.");
      const token = name.slice(7);
      const committed = await db.localDataState.findUnique({ where: { id: "clear" } });
      if (committed?.clearToken === token) { await remove(directory); continue; }
      // An uncommitted/crashed wipe is rolled back; committed wipes are only cleaned up.
      for (const child of await readdir(directory)) {
        if (child === "manifest.json") continue;
        if (!(managedDirectories as readonly string[]).includes(child)) throw new Error("Unexpected recovery content. No files were removed.");
        const destination = path.join(root, child);
        try { await lstat(destination); } catch (error) {
          if (notFound(error)) { await move(path.join(directory, child), destination); continue; }
          throw error;
        }
        throw new Error("Recovery needs attention: both staged and active storage exist. Data was not overwritten.");
      }
      await remove(directory);
    }
  }
  async function counts(): Promise<DataCounts> {
    const [payslips, emails, attachments, imports, originals] = await Promise.all([
      db.payslip.count(), db.email.count(), db.attachment.count(), db.mboxImport.count(),
      inventory(path.join(root, "originals")),
    ]);
    const allStorage = await inventory(root);
    let databaseBytes = 0;
    if (options.databasePath) {
      for (const suffix of ["", "-wal", "-shm", "-journal"]) databaseBytes += (await inventory(`${options.databasePath}${suffix}`)).bytes;
    }
    return { payslips, emails, attachments, imports, originals: originals.files, documentBytes: originals.bytes,
      temporaryBytes: Math.max(0, allStorage.bytes - originals.bytes - (await inventory(path.join(root, "tesseract"))).bytes),
      databaseBytes, storageBytes: allStorage.bytes + databaseBytes };
  }
  async function clear(confirmation: unknown) {
    if (!validDeleteConfirmation(confirmation)) throw new Error("Type DELETE exactly and confirm that this cannot be undone.");
    if (await db.mboxImport.count({ where: { status: { in: ["processing", "uploading", "writing", "unlocking"] } } })) throw new DataBusyError();
    await mkdir(root, { recursive: true });
    await recover();
    const before = await counts();
    const token = randomUUID(), directory = path.join(root, `.clear-${token}`);
    await mkdir(directory, { mode: 0o700 });
    await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ token, directories: managedDirectories }), { mode: 0o600, flag: "wx" });
    let committed = false;
    try {
      for (const name of managedDirectories) {
        const source = path.join(root, name);
        try { await lstat(source); } catch (error) { if (notFound(error)) continue; throw error; }
        await move(source, path.join(directory, name));
      }
      await db.$queryRawUnsafe("PRAGMA secure_delete = ON");
      await db.$transaction(async (tx) => {
        await tx.payslip.deleteMany();
        await tx.mboxImport.deleteMany();
        await options.beforeCommit?.();
        await tx.localDataState.upsert({ where: { id: "clear" }, create: { id: "clear", clearToken: token }, update: { clearToken: token } });
      });
      committed = true;
      await remove(directory);
      await db.$executeRawUnsafe("VACUUM");
      await db.$queryRawUnsafe("PRAGMA wal_checkpoint(TRUNCATE)");
      return { deleted: before.payslips, counts: await counts() };
    } catch (error) {
      if (!committed) {
        try { await recover(); } catch {
          throw new Error("Deletion stopped before clearing records. Original files remain staged locally; retry Clear All to recover them.");
        }
        throw new Error("Nothing was deleted. The data could not be safely staged or cleared. Check local file permissions and try again.", { cause: error });
      }
      throw new Error("Records were cleared, but local cleanup did not finish. Retry Clear All Data to remove remaining files.", { cause: error });
    }
  }
  return { counts, clear, recover };
}

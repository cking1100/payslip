import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, readdir, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "./prisma";
import { createDataManager, validDeleteConfirmation } from "./data-management";
import { withDataOperation, withExclusiveDataOperation, DataBusyError } from "./data-operation";
import { importDocument } from "./documents";
import { samplePdf } from "./test-fixtures";

const fixture = await vi.hoisted(async () => {
  const fs = await import("node:fs/promises"), os = await import("node:os"), path = await import("node:path");
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "payslip-clear-test-"));
  return { directory, data: path.join(directory, "data") };
});
vi.mock("./prisma", async () => {
  const { PrismaClient } = await import("@prisma/client");
  return { prisma: new PrismaClient({ datasourceUrl: `file:${fixture.directory.replaceAll("\\", "/")}/test.db` }) };
});
vi.mock("./local-data", () => ({ localDataDirectory: fixture.data }));
const confirmation = { confirmation: "DELETE", acknowledged: true };
const manager = () => createDataManager(prisma, fixture.data, { databasePath: path.join(fixture.directory, "test.db") });

beforeAll(() => {
  execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "push", "--skip-generate"], {
    env: { ...process.env, DATABASE_URL: `file:${fixture.directory.replaceAll("\\", "/")}/test.db`, PRISMA_HIDE_UPDATE_MESSAGE: "1" }, stdio: "pipe",
  });
});
beforeEach(async () => {
  await prisma.payslip.deleteMany(); await prisma.mboxImport.deleteMany(); await prisma.localDataState.deleteMany();
  await mkdir(fixture.data, { recursive: true });
  for (const name of await readdir(fixture.data)) await rm(path.join(fixture.data, name), { recursive: true, force: true });
});
afterEach(() => vi.restoreAllMocks());
afterAll(async () => { await prisma.$disconnect(); await rm(fixture.directory, { recursive: true, force: true }); });
async function seed() {
  await mkdir(path.join(fixture.data, "originals"), { recursive: true });
  await writeFile(path.join(fixture.data, "originals", "orphan.pdf"), "synthetic orphan");
  const imported = await importDocument(samplePdf(), "fixture.pdf");
  await prisma.mboxImport.create({ data: { id: "synthetic-import", filename: "fixture.mbox", expectedBytes: 0, status: "complete",
    emails: { create: { id: "synthetic-email", sender: "fixture@example.test", attachments: { create: { id: "synthetic-attachment", filename: "locked.pdf", mimeType: "application/pdf", sha256: "synthetic-hash", size: 4, storedFilename: "locked.pdf", status: "protected" } } } } } });
  await writeFile(path.join(fixture.data, "originals", "locked.pdf"), "fake");
  for (const name of ["temp", "previews", "thumbnails", "cache", "statistics"]) {
    await mkdir(path.join(fixture.data, name));
    await writeFile(path.join(fixture.data, name, "fixture"), "synthetic private data");
  }
  await mkdir(path.join(fixture.data, "tesseract"));
  await writeFile(path.join(fixture.data, "tesseract", "model"), "reusable model");
  return imported.payslip;
}
describe("isolated local data management", () => {
  it("requires exact typed DELETE and both confirmations without touching data", async () => {
    await seed();
    for (const value of [null, {}, { confirmation: "DELETE" }, { confirmation: "delete", acknowledged: true }, { confirmation: " DELETE ", acknowledged: true }, { confirmation: "DELETE", acknowledged: false }]) {
      expect(validDeleteConfirmation(value)).toBe(false);
      await expect(manager().clear(value)).rejects.toThrow("Type DELETE exactly");
    }
    expect(await prisma.payslip.count()).toBe(1);
    expect((await manager().counts()).originals).toBe(3);
  });
  it("measures actual file bytes, metadata counts and database bytes", async () => {
    await seed();
    const counts = await manager().counts();
    expect(counts).toMatchObject({ payslips: 1, emails: 1, attachments: 1, imports: 1, originals: 3 });
    expect(counts.documentBytes).toBe(samplePdf().length + Buffer.byteLength("synthetic orphan") + Buffer.byteLength("fake"));
    expect(counts.databaseBytes).toBeGreaterThan(0);
    expect(counts.storageBytes).toBeGreaterThan(counts.databaseBytes + counts.documentBytes);
  });
  it("removes records, fields, lines, hashes, histories, originals, orphan files and derived caches; reimports successfully", async () => {
    await seed();
    expect(await prisma.payslipField.count()).toBeGreaterThan(0);
    const result = await manager().clear(confirmation);
    expect(result.deleted).toBe(1);
    expect(result.counts).toMatchObject({ payslips: 0, emails: 0, attachments: 0, imports: 0, originals: 0, documentBytes: 0, temporaryBytes: 0 });
    expect(await prisma.payslipField.count()).toBe(0);
    expect(await prisma.payslipLine.count()).toBe(0);
    expect(await readdir(fixture.data)).toEqual(["tesseract"]);
    expect(await readFile(path.join(fixture.data, "tesseract", "model"), "utf8")).toBe("reusable model");
    expect((await importDocument(samplePdf(), "reimport.pdf")).duplicate).toBe(false);
    expect(await prisma.payslip.count()).toBe(1);
  });
  it("clears empty storage and many records without false counts", async () => {
    expect((await manager().clear(confirmation)).deleted).toBe(0);
    await prisma.payslip.createMany({ data: Array.from({ length: 100 }, (_, index) => ({ filename: `synthetic-${index}.pdf`, contentHash: `hash-${index}` })) });
    expect((await manager().clear(confirmation)).deleted).toBe(100);
    expect(await prisma.payslip.count()).toBe(0);
  });
  it("refuses active Gmail processing and upload", async () => {
    for (const status of ["processing", "uploading", "writing", "unlocking"]) {
      await prisma.mboxImport.create({ data: { id: status, status, filename: "fixture.mbox", expectedBytes: 0 } });
      await expect(manager().clear(confirmation)).rejects.toBeInstanceOf(DataBusyError);
      await prisma.mboxImport.delete({ where: { id: status } });
    }
  });
  it("restores files and preserves records when staging or the transaction fails", async () => {
    await seed();
    const failedMove = createDataManager(prisma, fixture.data, { move: async () => { throw new Error("synthetic permissions failure"); } });
    await expect(failedMove.clear(confirmation)).rejects.toThrow("Nothing was deleted");
    expect((await manager().counts()).originals).toBe(3);
    const failedTransaction = createDataManager(prisma, fixture.data, { beforeCommit: async () => { throw new Error("synthetic transaction failure"); } });
    await expect(failedTransaction.clear(confirmation)).rejects.toThrow("Nothing was deleted");
    expect(await prisma.payslip.count()).toBe(1);
    expect((await manager().counts()).originals).toBe(3);
    expect((await readdir(fixture.data)).some((name) => name.startsWith(".clear-"))).toBe(false);
  });
  it("reports committed cleanup failure explicitly and completes on retry", async () => {
    await seed();
    const failedCleanup = createDataManager(prisma, fixture.data, { remove: async () => { throw new Error("synthetic locked file"); } });
    await expect(failedCleanup.clear(confirmation)).rejects.toThrow("Records were cleared, but local cleanup");
    expect(await prisma.payslip.count()).toBe(0);
    expect((await readdir(fixture.data)).some((name) => name.startsWith(".clear-"))).toBe(true);
    await manager().clear(confirmation);
    expect(await readdir(fixture.data)).toEqual(["tesseract"]);
  });
  it("recovers an interrupted uncommitted staging operation without overwriting anything", async () => {
    await seed();
    const staged = path.join(fixture.data, ".clear-00000000-0000-4000-8000-000000000001");
    await mkdir(staged); await rename(path.join(fixture.data, "originals"), path.join(staged, "originals"));
    await manager().recover();
    expect((await manager().counts()).originals).toBe(3);
    expect(await prisma.payslip.count()).toBe(1);
  });
  it("does not follow storage symlinks into unrelated files", async () => {
    await seed();
    const outside = path.join(fixture.directory, "outside");
    await mkdir(outside); await writeFile(path.join(outside, "keep"), "not app data");
    await symlink(outside, path.join(fixture.data, "originals", "external-link"), process.platform === "win32" ? "junction" : "dir");
    expect((await manager().counts()).originals).toBe(3);
    await manager().clear(confirmation);
    expect((await stat(path.join(outside, "keep"))).size).toBe(12);
  });
  it("serializes deletion against normal uploads and corrections", async () => {
    let finish: () => void = () => undefined;
    const hold = withDataOperation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await expect(withExclusiveDataOperation(async () => undefined)).rejects.toBeInstanceOf(DataBusyError);
    finish(); await hold;
    const exclusive = withExclusiveDataOperation(() => new Promise<void>((resolve) => { finish = resolve; }));
    await expect(withDataOperation(async () => undefined)).rejects.toBeInstanceOf(DataBusyError);
    finish(); await exclusive;
    await expect(withDataOperation(async () => "ready")).resolves.toBe("ready");
  });
});

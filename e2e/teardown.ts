import { readFile, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export default async function teardown() {
  const manifest = path.join(process.cwd(), "test-results", "runtime-storage.json");
  let content: string;
  try { content = await readFile(manifest, "utf8"); } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== "object" || !("directory" in value) || typeof value.directory !== "string") throw new Error("Invalid isolated test storage manifest.");
  const directory = path.resolve(value.directory);
  if (path.dirname(directory) !== path.resolve(tmpdir()) || !/^payslip-browser-test-[A-Za-z0-9]+$/.test(path.basename(directory))) throw new Error("Unsafe browser test cleanup path.");
  if ("pid" in value && typeof value.pid === "number" && Number.isSafeInteger(value.pid) && value.pid > 0 && process.platform === "win32") {
    execFileSync("powershell.exe", ["-NoProfile", "-Command", `$p = Get-Process -Id ${value.pid} -ErrorAction SilentlyContinue; if ($p) { Stop-Process -Id ${value.pid} -Force }`], { stdio: "pipe" });
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  await rm(directory, { recursive: true, force: true });
  await unlink(manifest);
}

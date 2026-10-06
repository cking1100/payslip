import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

const directory = await mkdtemp(path.join(tmpdir(), "payslip-browser-test-"));
await mkdir(path.join(process.cwd(), "test-results"), { recursive: true });
await writeFile(path.join(process.cwd(), "test-results", "runtime-storage.json"), JSON.stringify({ directory }), { mode: 0o600 });
const env = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  PAYSLIP_DATA_DIR: path.join(directory, "data"),
  DATABASE_URL: `file:${path.join(directory, "test.db").replaceAll("\\", "/")}`,
  PAYSLIP_TEST_INSTANCE: "isolated-browser-test",
  PAYSLIP_DIST_DIR: ".next-e2e",
};
let child;
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  if (child && child.exitCode === null) {
    if (process.platform === "win32") execFileSync("powershell.exe", ["-NoProfile", "-Command", `Stop-Process -Id ${child.pid} -Force`], { stdio: "ignore" });
    else child.kill("SIGTERM");
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once("exit", resolve));
  }
  await rm(directory, { recursive: true, force: true });
  process.exit(code);
}
try {
  execFileSync(process.execPath, [path.join(process.cwd(), "node_modules", "prisma", "build", "index.js"), "db", "push", "--skip-generate"], { env, stdio: "pipe" });
  child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "--hostname", "127.0.0.1", "--port", "3107"], { env, stdio: "inherit" });
  await writeFile(path.join(process.cwd(), "test-results", "runtime-storage.json"), JSON.stringify({ directory, pid: child.pid }), { mode: 0o600 });
  child.once("exit", (code) => { void close(code ?? 1); });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => { void close(); });
} catch (error) {
  console.error("The isolated browser test server could not start:", error instanceof Error ? error.message : "unknown failure");
  await close(1);
}

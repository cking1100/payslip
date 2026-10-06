import type { NextRequest } from "next/server";

export function isLocalRequest(request: NextRequest): boolean {
  const host = request.headers.get("host");
  if (!host) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    if (!["localhost", "127.0.0.1", "[::1]"].includes(hostname)) return false;
    const origin = request.headers.get("origin");
    return !origin || new URL(origin).host === host;
  } catch {
    return false;
  }
}

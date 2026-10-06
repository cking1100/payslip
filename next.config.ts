import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.PAYSLIP_DIST_DIR ?? ".next",
  serverExternalPackages: ["@prisma/client", "pdfjs-dist", "tesseract.js", "@napi-rs/canvas", "mailparser"],
};

export default nextConfig;

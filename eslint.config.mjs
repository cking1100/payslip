import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import { globalIgnores } from "eslint/config";

const compat = new FlatCompat({ baseDirectory: dirname(fileURLToPath(import.meta.url)) });

const config = [...compat.extends("next/core-web-vitals", "next/typescript")];

const eslintConfig = [globalIgnores([".next/**", ".next-e2e/**", "node_modules/**", "out/**", "coverage/**", "test-results/**", "playwright-report/**", "next-env.d.ts"]), ...config];

export default eslintConfig;

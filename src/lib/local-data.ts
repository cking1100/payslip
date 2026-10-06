import path from "node:path";

export const localDataDirectory = process.env.PAYSLIP_DATA_DIR
  ? path.resolve(process.env.PAYSLIP_DATA_DIR)
  : path.join(process.cwd(), ".payslip-data");

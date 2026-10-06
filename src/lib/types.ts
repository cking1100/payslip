export type PayslipLine = {
  id: string;
  category: string;
  label: string;
  amount: number | null;
  ytdAmount: number | null;
  sourceText: string | null;
  confidence: string;
  manuallyCorrected: boolean;
  originalAmount: number | null;
  page: number | null;
};

export type PayslipField = {
  id: string;
  key: string;
  value: string | null;
  originalValue: string | null;
  label: string | null;
  confidence: string;
  sourceText: string | null;
  page: number | null;
  manuallyCorrected: boolean;
};

export type Payslip = {
  id: string;
  filename: string;
  employer: string | null;
  employeeName: string | null;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  grossPay: number | null;
  netPay: number | null;
  tax: number | null;
  nationalInsurance: number | null;
  pension: number | null;
  studentLoan: number | null;
  otherDeductions: number | null;
  hoursWorked: number | null;
  hourlyRate: number | null;
  grossYtd: number | null;
  taxYtd: number | null;
  nationalInsuranceYtd: number | null;
  pensionYtd: number | null;
  netYtd: number | null;
  extractionVersion?: number;
  importedAt: string;
  lines: PayslipLine[];
  fields: PayslipField[];
  attachment?: {
    filename: string;
    email: { sender: string | null; subject: string | null; emailDate: string | null };
  } | null;
};

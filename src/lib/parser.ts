export type Confidence = "High" | "Medium" | "Low";
export type LineCategory = "earning" | "deduction" | "employer_contribution" | "other";

export type ParsedLine = {
  category: LineCategory;
  label: string;
  amount: number | null;
  ytdAmount: number | null;
  sourceText: string;
  confidence: Confidence;
  page: number;
};

export type ParsedAttribute = {
  value: string;
  label: string;
  sourceText: string;
  confidence: Confidence;
  page: number;
};

export type ParsedPayslip = {
  employer: string | null;
  employeeName: string | null;
  payDate: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  attributes: Record<string, ParsedAttribute>;
  fields: Record<string, ParsedLine>;
  lines: ParsedLine[];
};

const patterns: Record<string, RegExp> = {
  grossYtd: /^\s*(?:(?:this\s+emp(?:loyee)?\s+)?ytd\s+txble\s+gross|(?:gross(?:\s+(?:pay|earnings|salary|taxable))?)\s+(?:ytd|year\s+to\s+date)|(?:ytd|year\s+to\s+date)\s+(?:gross(?:\s+(?:pay|earnings|salary|taxable))?))\b/i,
  taxYtd: /^\s*(?:(?:this\s+emp(?:loyee)?\s+ytd\s+(?:tax|paye)\s+paid)|(?:(?:tax|paye)\s+(?:paid\s+)?(?:ytd|year\s+to\s+date))|(?:(?:ytd|year\s+to\s+date)\s+(?:tax|paye)))\b/i,
  nationalInsuranceYtd: /^\s*(?:(?:(?:ni|national\s+insurance)\s+(?:ytd|year\s+to\s+date|to\s+date))|(?:(?:ytd|year\s+to\s+date|to\s+date)\s+(?:ni|national\s+insurance)))\b/i,
  pensionYtd: /^\s*(?:pension\s+(?:ytd|year\s+to\s+date)|(?:ytd|year\s+to\s+date)\s+pension)\b/i,
  netYtd: /^\s*(?:(?:net(?:\s+pay)?|take[\s-]*home)\s+(?:ytd|year\s+to\s+date)|(?:ytd|year\s+to\s+date)\s+(?:net(?:\s+pay)?|take[\s-]*home))\b/i,
  grossPay: /^\s*(?:(?:total|period|current)\s+)?(?:gross(?:\s+(?:pay|earnings|salary))?|payments?)\b/i,
  totalDeductions: /^\s*total\s+deductions?\b/i,
  netPay: /\b(?:net(?:\s+(?:pay|payment|salary))?|take[\s-]*home(?:\s+pay)?|payment)\b/i,
  tax: /\b(?:p\.?\s*a\.?\s*y\.?\s*e\.?\s*(?:tax)?|income\s+tax|tax)\b/i,
  nationalInsurance: /\b(?:national\s+insurance|employee\s+ni|ni\s+(?:contributions?|deduction)?|ni)\b/i,
  pension: /\b(?:NEST\s+EE\s+Contribution|(?:employee\s+)?pension(?:\s+(?:contribution|deduction))?)\b/i,
  studentLoan: /\bstudent\s+loan\b/i,
  hoursWorked: /\b(?:total\s+)?hours(?:\s+worked)?\b/i,
  hourlyRate: /\b(?:hourly\s+rate|rate\s+per\s+hour)\b/i,
};

const moneyPattern = /(?:£\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)/g;

function amountsIn(line: string): number[] {
  const values: number[] = [];
  for (const match of line.matchAll(moneyPattern)) {
    const raw = match[1];
    const before = line.slice(Math.max(0, match.index! - 2), match.index);
    const after = line.slice(match.index! + match[0].length, match.index! + match[0].length + 1);
    const labelContext = line.slice(0, match.index!);
    if (after === "%" || after === "/" || /\b(?:plan|code|category|reference|period)\s*$/i.test(labelContext)) continue;
    if (!raw.includes(".") && after === "/") continue;
    let value = Number(raw.replaceAll(",", ""));
    const wrapped = line.includes(`(${match[0]})`);
    if (wrapped || before.includes("-") || before.includes("(")) value = -value;
    values.push(value);
  }
  return values;
}

function categoryFor(label: string): LineCategory {
  if (/employer|company\s+pension|employer\s+ni/i.test(label)) return "employer_contribution";
  if (/\b(?:basea|holw|tronc|prem|incentive|bonus|training|refresher|learning|overtime|holiday|basic|salary|commission|allowance)\b/i.test(label)) return "earning";
  if (/\b(?:NEST\s+EE\s+Contribution|(?:ee|employee)\s+contribution)\b/i.test(label)) return "deduction";
  if (/tax|paye|national\s+insurance|\bni\b|pension|loan|union|deduction/i.test(label)) return "deduction";
  if (/basic|salary|pay|overtime|holiday|bonus|commission|allowance|earnings|hours/i.test(label)) return "earning";
  return "other";
}

function parsedValue(value: number, label: string, sourceText: string, page: number, ocrConfidence?: number): ParsedLine {
  return {
    category: "other",
    label,
    amount: value,
    ytdAmount: null,
    sourceText,
    confidence: ocrConfidence === undefined ? "Medium" : ocrConfidence < 60 ? "Low" : "Medium",
    page,
  };
}

function parseOverlaidYtd(sourceText: string, page: number, ocrConfidence: number | undefined, fields: Record<string, ParsedLine>): void {
  const labels: Array<[string, RegExp]> = [
    ["grossYtd", /\b(?:this\s+emp(?:loyee)?\s+)?ytd\s+txble\s+gross\b|\b(?:total\s+)?gross\s+ytd\b|\bytd\s+gross\b/i],
    ["taxYtd", /\bthis\s+emp(?:loyee)?\s+ytd\s+(?:tax|paye)\s+paid\b|\b(?:tax|paye)\s+(?:ytd|year\s+to\s+date)\b/i],
    ["nationalInsuranceYtd", /\b(?:ni|national\s+insurance)\s+(?:to\s+date|ytd|year\s+to\s+date)\b|\b(?:to\s+date|ytd)\s+(?:ni|national\s+insurance)\b/i],
  ];
  for (const [key, pattern] of labels) {
    const match = pattern.exec(sourceText);
    if (!match || fields[key]) continue;
    const amount = amountsIn(sourceText.slice(match.index + match[0].length))[0];
    if (amount !== undefined) fields[key] = parsedValue(amount, match[0], sourceText, page, ocrConfidence);
  }
}

function parseLabeledDate(text: string, labels: string): string | null {
  const match = text.match(new RegExp(`(?:${labels})\\s*[:\\-]?\\s*(\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{4}-\\d{2}-\\d{2})`, "i"));
  if (!match) return null;
  const parts = match[1].split(/[/-]/).map(Number);
  let year: number;
  let month: number;
  let day: number;
  if (match[1].includes("-") && parts[0] > 31) [year, month, day] = parts;
  else {
    [day, month, year] = parts;
    if (year < 100) year += year < 50 ? 2000 : 1900;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) || date.getUTCMonth() !== month - 1 ? null : date.toISOString();
}

export function parsePayslip(text: string, page = 1, ocrConfidence?: number): ParsedPayslip {
  const fields: Record<string, ParsedLine> = {};
  const attributes: Record<string, ParsedAttribute> = {};
  const lines: ParsedLine[] = [];
  const baseRows: Array<{ hours: number; rate: number; amount: number; sourceText: string; matches: boolean }> = [];
  const sourceLines = text.replace(/\r/g, "").split("\n").map((line) => line.trim()).filter(Boolean);

  for (const sourceText of sourceLines) {
    if (/\b(?:national\s+insurance|ni|nino)\s*(?:number|no\.?|category|cat\.?)\b|\b(?:payroll|employee|staff)\s*(?:number|no\.?|id|reference)\b|\btax\s+code\b/i.test(sourceText)) continue;
    if (/\b(?:pay\s+)?date\b|\bpay\s+period\b|\bperiod\s+(?:start|end|ending)\b/i.test(sourceText) && /\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/.test(sourceText)) continue;
    const values = amountsIn(sourceText);
    if (!values.length) continue;

    const baseRow = /^\s*BaseA\s*(?:\(\s*HRS\s*\)|HRS)(?:\s|$)/i.test(sourceText);
    const holidayRow = /^\s*HOLW\b/i.test(sourceText);
    if (baseRow || holidayRow) {
      parseOverlaidYtd(sourceText, page, ocrConfidence, fields);
      const name = baseRow ? "BaseA" : "HOLW";
      const validColumns = values.length >= 3;
      const amount = validColumns ? values[2] : null;
      const confidence = validColumns
        ? ocrConfidence === undefined ? "Medium" : ocrConfidence < 60 ? "Low" : "Medium"
        : "Low";
      lines.push({ category: "earning", label: name, amount, ytdAmount: null, sourceText, confidence, page });
      if (validColumns) {
        const keys: Array<[string, number]> = baseRow
          ? [["baseHours", values[0]], ["baseRate", values[1]], ["baseGross", values[2]], ["hoursWorked", values[0]], ["hourlyRate", values[1]]]
          : [["holidayHours", values[0]], ["holidayRate", values[1]], ["holidayGross", values[2]]];
        for (const [key, value] of keys) fields[key] = parsedValue(value, name, sourceText, page, ocrConfidence);
        if (baseRow) {
          const matches = Math.abs(Math.round(values[0] * values[1] * 100) / 100 - values[2]) <= 0.02;
          baseRows.push({ hours: values[0], rate: values[1], amount: values[2], sourceText, matches });
        }
      } else if (baseRow) {
        attributes.baseRowValidation = { value: "review", label: "BaseA row has fewer than three numeric columns", sourceText, confidence: "Low", page };
      }
      continue;
    }

    const totalRow = /\btotal\s+payments\b/i.test(sourceText)
      && /\btotal\s+deductions\b/i.test(sourceText)
      && /\bnet\s+pay\b/i.test(sourceText);
    if (totalRow) {
      parseOverlaidYtd(sourceText, page, ocrConfidence, fields);
      if (values.length === 3) {
        fields.grossPay = parsedValue(values[0], "Total Payments", sourceText, page, ocrConfidence);
        fields.totalDeductions = parsedValue(values[1], "Total Deductions", sourceText, page, ocrConfidence);
        fields.netPay = parsedValue(values[2], "Net Pay", sourceText, page, ocrConfidence);
      } else {
        attributes.totalSummaryValidation = { value: "review", label: "Expected exactly three labelled totals", sourceText, confidence: "Low", page };
      }
      lines.push({ category: "other", label: "Total Payments / Total Deductions / Net Pay", amount: null, ytdAmount: null, sourceText, confidence: values.length === 3 ? ocrConfidence === undefined ? "Medium" : ocrConfidence < 60 ? "Low" : "Medium" : "Low", page });
      continue;
    }

    const fieldName = Object.keys(patterns).find((name) => patterns[name].test(sourceText));
    const label = sourceText.replace(moneyPattern, "").replace(/[£:|]/g, "").trim();
    const ytdScoped = /\b(?:ytd|year\s+to\s+date|cumulative)\b/i.test(sourceText);
    if (ytdScoped && fieldName && !fieldName.endsWith("Ytd")) continue;
    if (fieldName === "grossPay" && ytdScoped) continue;
    if (fieldName === "netPay" && ytdScoped) continue;
    const parsed: ParsedLine = {
      category: categoryFor(label),
      label: label || sourceText,
      amount: fieldName?.endsWith("Ytd") ? values.at(-1)! : values[0],
      ytdAmount: ytdScoped ? null : values.length > 1 ? values[1] : null,
      sourceText,
      confidence: ocrConfidence !== undefined
        ? ocrConfidence < 60 ? "Low" : "Medium"
        : /£/.test(sourceText) && values.length < 3 ? "High" : "Medium",
      page,
    };
    parseOverlaidYtd(sourceText, page, ocrConfidence, fields);
    if (fieldName === "grossPay" || fieldName === "totalDeductions" || fieldName === "netPay") {
      if (!fields[fieldName]) fields[fieldName] = { ...parsed, label: fieldName === "grossPay" ? "Total Payments" : fieldName === "totalDeductions" ? "Total Deductions" : "Net Pay" };
      lines.push({ ...parsed, category: "other", amount: null, ytdAmount: null });
      continue;
    }
    const knownEarningRow = /\b(?:tronc|prem|incentive|bonus|training|refresher|learning|overtime|holiday|basic|salary|commission|allowance)\b/i.test(sourceText);
    if (knownEarningRow && values.length) {
      const quantityRow = /\(\s*(?:hrs?|hours?)\s*\)/i.test(sourceText);
      lines.push({ ...parsed, category: "earning", amount: quantityRow ? values.at(-1)! : values[0], ytdAmount: null });
      continue;
    }
    if (fieldName && !fields[fieldName]) fields[fieldName] = parsed;
    lines.push(parsed);
  }

  const labeled = (label: string, excluded?: RegExp) => {
    for (const line of sourceLines) {
      const match = line.match(new RegExp(`^(?:${label})\\s*(?:[:\\-]\\s*|\\s{2,})([^\\n\\r]+)`, "i"));
      if (match && !excluded?.test(line)) return match[1].trim();
    }
    return null;
  };
  const period = text.match(/(?:pay\s+period|period)\s*[:\-]?\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s*(?:to|–|-)\s*(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})/i);
  const periodDate = (value?: string) => value ? parseLabeledDate(`Date: ${value}`, "Date") : null;
  const addAttribute = (key: string, labelPattern: string, value?: string | null) => {
    if (!value) return;
    const sourceText = sourceLines.find((line) => new RegExp(`(?:${labelPattern})`, "i").test(line)
      && !/\b(?:number|no\.?|id|reference)\b/i.test(line)
      && !(key === "employer" && /\b(?:pension|national\s+insurance|ni|contribution|tax)\b/i.test(line))
      && !(key === "employeeName" && /\b(?:pension|national\s+insurance|ni|tax|student\s+loan)\b/i.test(line)));
    if (!sourceText) return;
    const index = sourceText.toLowerCase().indexOf(value.toLowerCase());
    const label = sourceText.match(/^(.+?)(?::|-\s|\s{2,}|(?=\s+\d{1,2}[/-]))/)?.[1]?.trim();
    attributes[key] = {
      value,
      label: label || (index >= 0 ? sourceText.slice(0, index) : labelPattern).replace(/[:\s\-]+$/, "").trim(),
      sourceText,
      confidence: ocrConfidence === undefined ? "High" : ocrConfidence < 60 ? "Low" : "Medium",
      page,
    };
  };
  const employer = labeled("employer(?:\\s+name)?|company(?:\\s+name)?", /\b(?:pension|national\s+insurance|ni|contribution|tax)\b/i);
  const employeeName = labeled("employee\\s+name|employee", /\b(?:number|no\.?|id|reference|pension|national\s+insurance|ni|tax|student\s+loan)\b/i);
  addAttribute("employer", "employer(?:\\s+name)?|company(?:\\s+name)?", employer);
  addAttribute("employeeName", "employee\\s+name|employee", employeeName);
  const payDate = parseLabeledDate(text, "pay\\s+date|payment\\s+date");
  const periodStart = period ? periodDate(period[1]) : null;
  const periodEnd = period ? periodDate(period[2]) : parseLabeledDate(text, "period\\s+ending|pay\\s+period\\s+ending");
  addAttribute("payDate", "pay\\s+date|payment\\s+date", payDate);
  addAttribute("periodStart", "pay\\s+period|period", periodStart);
  addAttribute("periodEnd", "period\\s+ending|pay\\s+period\\s+ending|pay\\s+period|period", periodEnd);
  for (const [key, label, pattern] of [
    ["taxCode", "Tax code", /\btax\s+code\s*[:\-]?\s*([A-Z0-9]+(?:\s+(?:W1|M1|X))?)/i],
    ["niCategory", "NI category", /\b(?:ni|national\s+insurance)\s+categor(?:y|ies)\s*[:\-]?\s*([A-Z])\b/i],
    ["studentLoanPlan", "Student loan plan", /\bstudent\s+loan\s+plan\s*[:\-]?\s*(1|2|4|5|postgraduate)\b/i],
  ] as const) {
    const sourceText = sourceLines.find((line) => pattern.test(line));
    const value = sourceText?.match(pattern)?.[1];
    if (sourceText && value) attributes[key] = { value, label, sourceText, page, confidence: ocrConfidence === undefined ? "High" : ocrConfidence < 60 ? "Low" : "Medium" };
  }

  const gross = fields.grossPay?.amount;
  const deductions = fields.totalDeductions?.amount;
  const net = fields.netPay?.amount;
  if (gross !== undefined && gross !== null && deductions !== undefined && deductions !== null && net !== undefined && net !== null) {
    const reconciles = Math.abs(Math.round((gross - deductions - net) * 100) / 100) <= 0.02;
    attributes.totalSummaryValidation = {
      value: reconciles ? "passed" : "review",
      label: "Total payments - total deductions = net pay",
      sourceText: [fields.grossPay.sourceText, fields.totalDeductions.sourceText, fields.netPay.sourceText].join(" | "),
      confidence: reconciles ? "Medium" : "Low",
      page,
    };
  }
  if (baseRows.length) {
    const sourceText = baseRows.map((row) => row.sourceText).join(" | ");
    const hours = baseRows.reduce((sum, row) => sum + row.hours, 0);
    const amount = baseRows.reduce((sum, row) => sum + row.amount, 0);
    const rates = new Set(baseRows.map((row) => row.rate));
    fields.baseHours = parsedValue(hours, "BaseA hours total", sourceText, page, ocrConfidence);
    fields.hoursWorked = parsedValue(hours, "BaseA hours total", sourceText, page, ocrConfidence);
    fields.baseGross = parsedValue(amount, "BaseA gross total", sourceText, page, ocrConfidence);
    if (rates.size === 1) {
      fields.baseRate = parsedValue(baseRows[0].rate, "BaseA hourly rate", sourceText, page, ocrConfidence);
      fields.hourlyRate = parsedValue(baseRows[0].rate, "BaseA hourly rate", sourceText, page, ocrConfidence);
    } else {
      delete fields.baseRate;
      delete fields.hourlyRate;
    }
    const reconciles = baseRows.every((row) => row.matches);
    attributes.baseRowValidation = {
      value: reconciles ? "passed" : "review",
      label: "BaseA hours × rate validation",
      sourceText,
      confidence: reconciles ? ocrConfidence === undefined ? "Medium" : ocrConfidence < 60 ? "Low" : "Medium" : "Low",
      page,
    };
    attributes.baseARows = {
      value: JSON.stringify(baseRows.map(({ hours, rate, amount: rowAmount, matches, sourceText: rowSource }) => ({
        hours, rate, amount: rowAmount, validation: matches ? "passed" : "review", sourceText: rowSource,
      }))),
      label: "BaseA source rows",
      sourceText,
      confidence: reconciles ? ocrConfidence === undefined ? "Medium" : ocrConfidence < 60 ? "Low" : "Medium" : "Low",
      page,
    };
  }

  return {
    employer: attributes.employer?.value ?? null,
    employeeName: attributes.employeeName?.value ?? null,
    payDate: attributes.payDate?.value ?? null,
    periodStart: attributes.periodStart?.value ?? null,
    periodEnd: attributes.periodEnd?.value ?? null,
    attributes,
    fields,
    lines,
  };
}

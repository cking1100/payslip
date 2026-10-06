export type MboxAttachment = {
  id: string; filename: string; mimeType: string; size: number; status: string; error: string | null;
  payslip: { id: string; payDate: string | null } | null;
};
export type MboxResult = {
  id: string; filename: string; status: string; error: string | null;
  emailsScanned: number; payslipEmailsFound: number; attachmentsFound: number;
  duplicatesSkipped: number; emailsSkipped: number; malformedEmails: number;
  emails: Array<{ id: string; sender: string | null; recipient: string | null; subject: string | null; emailDate: string | null; attachments: MboxAttachment[] }>;
};
export type MboxProgress = {
  emailsScanned: number; payslipEmailsFound: number; attachmentsFound: number;
  duplicatesSkipped: number; emailsSkipped: number; malformedEmails: number; stage: string;
};

export type SMSPayload = {
  to: string;
  sms: string;
  from?: string;
};

export type EmailPayload = {
  template: string;
  recipient: string | { name?: string; email: string };
  subject: string;
  context: Record<string, unknown>;
};

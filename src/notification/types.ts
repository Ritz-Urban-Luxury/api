export type SMSPayload = {
  to: string;
  sms: string;
  from?: string;
  channel?: 'dnd' | 'generic';
};

export type EmailPayload = {
  template: string;
  recipient: string | { name?: string; email: string };
  subject: string;
  context: Record<string, unknown>;
};

export type WebhookPayload = {
  event:
    | 'charge.success'
    | 'transfer.success'
    | 'transfer.failed'
    | 'transfer.reversed'
    | 'refund.pending'
    | 'refund.processing'
    | 'refund.needs-attention'
    | 'refund.failed'
    | 'refund.processed';
  data: unknown;
};

export type ChargeSuccessData = {
  amount: number;
  channel: string;
  reference: string;
  authorization?: {
    last4?: string;
    brand?: string;
    channel?: string;
    sender_name?: string;
    sender_bank?: string;
    sender_bank_account_number?: string;
    account_name?: string;
    exp_month?: string;
    exp_year?: string;
    authorization_code?: string;
    signature?: string;
  };
  customer: {
    email: string;
  };
};

export type CustomerIdentificationSuccessData = {
  customer_code: string;
  customer_id: string;
  email: string;
  identification: {
    account_number: string;
    bank_code: string;
    bvn: string;
    country: string;
    type: string;
  };
};

export type TransferSuccessData = {
  reference: string;
  amount: number;
};

export type TransferFailureData = {
  reference: string;
  reason: string;
  amount: number;
};

export type TransferPayload = {
  amount: number;
  bankId?: string;
  accountNumber: string;
  reason: string;
  reference: string;
};

export type CreateTransferRecipientPayload = {
  accountName: string;
  accountNumber: string;
  bankCode: string;
};

export type CreateCustomerPayload = {
  email: string;
  first_name: string;
  last_name: string;
  phone?: string;
};

export type ValidateCustomerPayload = {
  country: 'NG';
  type: 'bank_account';
  account_number: string;
  bvn: string;
  bank_code: string;
  first_name: string;
  last_name: string;
  code: string;
};

export type CreatVirtualAccountPayload = {
  customer: string;
  preferred_bank: 'wema-bank';
};

export type ChargeAuthorizationPayload = {
  email: string;
  amount: number;
  authorization_code: string;
  reference?: string;
};

export type NigerianBank = {
  code: string;
  name: string;
  slug: string;
  type: string;
};

export type PaystackBank = NigerianBank & {
  active: boolean;
  country: string;
  currency: string;
  id: number;
  is_deleted: boolean;
};

export type ListBanksResponse = {
  status: boolean;
  message: string;
  data: PaystackBank[];
  meta?: {
    next?: string | null;
    previous?: string | null;
    perPage?: number;
  };
};

export type ResolveAccountResponse = {
  status: boolean;
  message: string;
  data: {
    account_number: string;
    account_name: string;
    bank_id: number;
  };
};

export type TransferRecipientResponse = {
  status: boolean;
  message: string;
  data: {
    recipient_code: string;
    name: string;
    details?: Record<string, unknown>;
  };
};

export type InitiateTransferResponse = {
  status: boolean;
  message: string;
  data: {
    status: string;
    reference: string;
    transfer_code?: string;
    id?: number;
  };
};

export type InitializeTransactionResponse = {
  status: boolean;
  message: string;
  data: {
    authorization_url: string;
    access_code: string;
    reference: string;
  };
};

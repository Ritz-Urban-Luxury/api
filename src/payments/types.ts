import { CardDocument } from '../database/schemas/card.schema';
import { UserDocument } from '../database/schemas/user.schema';

export interface PaymentProvider {
  chargeCard(payload: {
    user: UserDocument;
    card: CardDocument;
    amount: number;
    reference: string;
  }): Promise<unknown>;

  refund?(payload: {
    transaction: string | number;
    amount?: number;
    currency?: string;
    customer_note?: string;
    merchant_note?: string;
  }): Promise<unknown>;
}

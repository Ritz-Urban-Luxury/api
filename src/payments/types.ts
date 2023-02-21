import { CardDocument } from '../database/schemas/card.schema';
import { UserDocument } from '../database/schemas/user.schema';

export interface PaymentProvider {
  chargeCard(payload: {
    user: UserDocument;
    card: CardDocument;
    amount: number;
  }): Promise<unknown>;
}

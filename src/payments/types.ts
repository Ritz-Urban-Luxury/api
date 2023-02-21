import { CardDocument } from 'src/database/schemas/card.schema';
import { UserDocument } from 'src/database/schemas/user.schema';

export interface PaymentProvider {
  chargeCard(payload: {
    user: UserDocument;
    card: CardDocument;
    amount: number;
  }): Promise<unknown>;
}

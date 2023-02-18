import { Injectable } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { UserDocument } from 'src/database/schemas/user.schema';
import { Util } from 'src/shared/util';
import { RequestReferenceDTO } from './dto/payment.dto';

@Injectable()
export class PaymentService {
  constructor(private readonly db: DatabaseService) {}

  async getUserBalance(user: UserDocument) {
    return this.db.balances.findOneAndUpdate(
      { user: user.id },
      { user: user.id, deleted: false },
      { new: true, upsert: true },
    );
  }

  async generateReference(user: UserDocument, payload: RequestReferenceDTO) {
    let meta = { type: 'payment-reference', user: user.id };
    if (Util.isPriObj(payload.meta)) {
      meta = { ...payload.meta, ...meta };
    }

    const token = Math.random().toString(32).substring(2);

    await this.db.authTokens.create({
      token,
      meta,
    });

    return token;
  }
}

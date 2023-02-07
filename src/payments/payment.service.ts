import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { DB_TABLES } from 'src/shared/constants';
import { Model } from 'src/shared/types';
import { UserDocument } from 'src/user';
import { BalanceDocument } from './schemas/balance.schema';

@Injectable()
export class PaymentService {
  constructor(
    @InjectModel(DB_TABLES.BALANCES)
    private readonly balanceModel: Model<BalanceDocument>,
  ) {}

  async getUserBalance(user: UserDocument) {
    return this.balanceModel.findOneAndUpdate(
      { user: user.id },
      { user: user.id, deleted: false },
      { new: true, upsert: true },
    );
  }
}

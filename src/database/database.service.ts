import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FilterQuery,
  PopulateOptions,
  QueryOptions,
  UpdateQuery,
} from 'mongoose';
import { BalanceDocument } from 'src/authentication/balance.schema';
import { DB_TABLES } from 'src/shared/constants';
import { Document, Model } from 'src/shared/types';
import { AuthTokenDocument } from './schemas/auth-tokens.schema';
import { MessageDocument } from './schemas/messages.schema';
import { RidesDocument } from './schemas/rides.schema';
import { TripDocument } from './schemas/trips.schema';
import { UserDocument } from './schemas/user.schema';

@Injectable()
export class DatabaseService {
  constructor(
    @InjectModel(DB_TABLES.AUTH_TOKENS)
    public readonly authTokens: Model<AuthTokenDocument>,
    @InjectModel(DB_TABLES.USERS)
    public readonly users: Model<UserDocument>,
    @InjectModel(DB_TABLES.RIDES)
    public readonly rides: Model<RidesDocument>,
    @InjectModel(DB_TABLES.TRIPS)
    public readonly trips: Model<TripDocument>,
    @InjectModel(DB_TABLES.BALANCES)
    public readonly balances: Model<BalanceDocument>,
    @InjectModel(DB_TABLES.MESSAGES)
    public readonly messages: Model<MessageDocument>,
  ) {}

  async findOrFail<
    K extends Document,
    T extends Model<K> = Model<K>,
    J extends Error = Error,
  >(
    model: T,
    query: FilterQuery<K>,
    options: {
      error?: J;
      populate?: PopulateOptions | (string | PopulateOptions)[];
    } = {},
  ) {
    const q = model.findOne(query);
    if (options.populate) {
      q.populate(options.populate);
    }

    const doc = await q;
    if (!doc) {
      if (options.error) {
        throw options.error;
      }

      throw new NotFoundException('record not found');
    }

    return doc;
  }

  async findAndUpdateOrFail<
    K extends Document,
    T extends Model<K> = Model<K>,
    J extends Error = Error,
  >(
    model: T,
    query: FilterQuery<K>,
    update?: UpdateQuery<K>,
    options: {
      error?: J;
      options?: QueryOptions<K>;
      populate?: PopulateOptions | (string | PopulateOptions)[];
    } = {},
  ) {
    const q = model.findOneAndUpdate(query, update, options.options);
    if (options.populate) {
      q.populate(options.populate);
    }

    const doc = await q;
    if (!doc) {
      if (options.error) {
        throw options.error;
      }

      throw new NotFoundException('record not found');
    }

    return doc;
  }
}

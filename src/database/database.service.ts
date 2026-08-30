import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  FilterQuery,
  PopulateOptions,
  QueryOptions,
  UpdateQuery,
} from 'mongoose';
import { BalanceDocument } from '../authentication/balance.schema';
import { DB_TABLES } from '../shared/constants';
import { Document, Model } from '../shared/types';
import { ActivityDocument } from './schemas/activities.schema';
import { AuthTokenDocument } from './schemas/auth-tokens.schema';
import { CardDocument } from './schemas/card.schema';
import { CarBrandDocument } from './schemas/car-brands.schema';
import { DriverEarningDocument } from './schemas/driver-earnings.schema';
import { DriverLedgerEntryDocument } from './schemas/driver-ledger.schema';
import { DriverOnlineSessionDocument } from './schemas/driver-online-session.schema';
import { DriverRideOfferDocument } from './schemas/driver-ride-offer.schema';
import { MessageDocument } from './schemas/messages.schema';
import { RentalDocument } from './schemas/rentals.schema';
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
    @InjectModel(DB_TABLES.CARDS)
    public readonly cards: Model<CardDocument>,
    @InjectModel(DB_TABLES.RENTALS)
    public readonly rentals: Model<RentalDocument>,
    @InjectModel(DB_TABLES.CAR_BRANDS)
    public readonly carBrands: Model<CarBrandDocument>,
    @InjectModel(DB_TABLES.DRIVER_EARNINGS)
    public readonly driverEarnings: Model<DriverEarningDocument>,
    @InjectModel(DB_TABLES.DRIVER_LEDGER_ENTRIES)
    public readonly driverLedgerEntries: Model<DriverLedgerEntryDocument>,
    @InjectModel(DB_TABLES.DRIVER_RIDE_OFFERS)
    public readonly driverRideOffers: Model<DriverRideOfferDocument>,
    @InjectModel(DB_TABLES.DRIVER_ONLINE_SESSIONS)
    public readonly driverOnlineSessions: Model<DriverOnlineSessionDocument>,
    @InjectModel(DB_TABLES.ACTIVITIES)
    public readonly activities: Model<ActivityDocument>,
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

  async markTokenAsUsedOrFail<E extends Error>(
    query: FilterQuery<AuthTokenDocument>,
    error?: E,
  ) {
    const token = await this.authTokens.findOneAndUpdate(
      query,
      { $set: { isUsed: true } },
      { new: true, upsert: false },
    );
    if (!token) {
      throw error || new BadRequestException('invalid otp');
    }

    return token;
  }
}

import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery } from 'mongoose';
import { DB_TABLES } from 'src/shared/constants';
import { Model } from 'src/shared/types';
import { User, UserDocument } from './schemas';

@Injectable()
export class UserService {
  constructor(
    @InjectModel(DB_TABLES.USERS)
    private readonly userModel: Model<UserDocument>,
  ) {}

  findUser(query: FilterQuery<UserDocument>) {
    return this.userModel.findOne(query);
  }

  createUser(user: User) {
    return this.userModel.create(user);
  }
}

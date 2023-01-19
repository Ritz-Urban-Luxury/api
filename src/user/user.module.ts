import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DB_TABLES } from 'src/shared/constants';
import { UserSchema } from './schemas';
import { UserService } from './user.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: DB_TABLES.USERS, schema: UserSchema }]),
  ],
  providers: [UserService],
  exports: [UserService],
})
export class UserModule {}

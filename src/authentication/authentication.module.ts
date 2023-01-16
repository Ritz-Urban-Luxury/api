import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationModule } from 'src/notification';
import { DB_TABLES } from 'src/shared/constants';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { AuthTokenSchema } from './schemas';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLES.AUTH_TOKENS, schema: AuthTokenSchema },
    ]),
    NotificationModule,
  ],
  providers: [AuthenticationService],
  controllers: [AuthenticationController],
  exports: [AuthenticationService],
})
export class AuthenticationModule {}

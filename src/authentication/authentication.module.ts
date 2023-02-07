import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationModule } from 'src/notification';
import config from 'src/shared/config';
import { DB_TABLES } from 'src/shared/constants';
import { UserModule } from 'src/user';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { AuthTokenSchema } from './schemas';
import { JwtStrategy } from './strategy/jwt.strategy';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DB_TABLES.AUTH_TOKENS, schema: AuthTokenSchema },
    ]),
    JwtModule.registerAsync({
      useFactory() {
        const { secret, expiresIn } = config().jwt;

        return {
          secret,
          signOptions: { expiresIn },
        };
      },
    }),
    NotificationModule,
    UserModule,
  ],
  providers: [AuthenticationService, JwtStrategy],
  controllers: [AuthenticationController],
  exports: [AuthenticationService],
})
export class AuthenticationModule {}

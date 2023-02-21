import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { NotificationModule } from '../notification';
import config from '../shared/config';
import { AuthenticationController } from './authentication.controller';
import { AuthenticationService } from './authentication.service';
import { JwtStrategy } from './strategy/jwt.strategy';
import { WSJWTStrategy } from './strategy/ws-jwt.guard';

@Module({
  imports: [
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
  ],
  providers: [AuthenticationService, JwtStrategy, WSJWTStrategy],
  controllers: [AuthenticationController],
  exports: [AuthenticationService],
})
export class AuthenticationModule {}

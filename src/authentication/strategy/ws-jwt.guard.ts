import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-jwt';
import config from 'src/shared/config';
import { AuthenticationService } from '../authentication.service';

@Injectable()
export class WSJWTStrategy extends PassportStrategy(Strategy, 'ws-jwt') {
  constructor(private authenticationService: AuthenticationService) {
    super({
      jwtFromRequest: (request) =>
        request.handshake.headers.authorization ||
        request.handshake.query.authorization,
      ignoreExpiration: true,
      secretOrKey: config().jwt.secret,
    });
  }

  async validate(payload) {
    return this.authenticationService.validateJwtPayload(payload);
  }
}

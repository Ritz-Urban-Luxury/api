import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { compare } from 'bcryptjs';
import { ExtractJwt, Strategy } from 'passport-jwt';
import config from 'src/shared/config';
import { UserService } from 'src/user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private userService: UserService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: true,
      secretOrKey: config().jwt.secret,
    });
  }

  async validate({ id: _id, payloadId = '' }) {
    const user = await this.userService.findUser({
      _id,
    });
    if (user) {
      const isValid = await compare(
        `${user.phoneNumber}${user.password}`,
        payloadId,
      );
      if (isValid) {
        return user;
      }
    }

    return null;
  }
}

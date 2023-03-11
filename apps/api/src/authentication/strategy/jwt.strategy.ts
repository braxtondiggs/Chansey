import { User as AuthorizerUser } from '@authorizerdev/authorizer-js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

import User from '../../users/users.entity';
import UsersService from '../../users/users.service';
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(readonly configService: ConfigService, private readonly userService: UsersService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET')
    });
  }

  async validate(payload: AuthorizerUser): Promise<User> {
    const user = await this.userService.getById(payload.id);
    const { given_name, family_name, email } = payload;
    return new User({ ...user, given_name, family_name, email });
  }
}

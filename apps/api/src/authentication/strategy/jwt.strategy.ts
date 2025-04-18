import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { User as AuthorizerUser } from '@authorizerdev/authorizer-js';
import { ExtractJwt, Strategy } from 'passport-jwt';

import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    readonly configService: ConfigService,
    private readonly userService: UsersService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
      algorithms: ['HS512']
    });
  }

  async validate(payload: AuthorizerUser): Promise<User> {
    const user = await this.userService.getById(payload.id);
    // Include all Authorizer profile fields in the user object
    return new User({
      ...user,
      // Include all properties from the payload
      ...payload,
      // Ensure these critical fields are explicitly set
      given_name: payload.given_name,
      family_name: payload.family_name,
      email: payload.email
    });
  }
}

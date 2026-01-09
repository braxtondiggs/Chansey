import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';

import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';

interface AccessTokenPayload {
  sub: string; // User ID
  email: string; // User email
  roles: string[]; // Roles assigned to user
  type: string; // Token type ('access' or 'refresh')
  exp: number; // Expiration time (in seconds since epoch)
  iat: number; // Issued at time (in seconds since epoch)
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    readonly configService: ConfigService,
    private readonly userService: UsersService
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        (request) => {
          return request.cookies?.chansey_access;
        }
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET'),
      algorithms: ['HS512']
    });
  }

  async validate(payload: AccessTokenPayload): Promise<User> {
    const userId = payload.sub;
    // Pass true for top_level parameter to include decrypted API keys
    const user = await this.userService.getById(userId, true);
    // Merge roles from JWT payload with user data
    return new User({
      ...user,
      roles: payload.roles || user.roles || ['user']
    });
  }
}

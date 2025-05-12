import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';

import { ExtractJwt, Strategy } from 'passport-jwt';

import { User } from '../../users/users.entity';
import { UsersService } from '../../users/users.service';

interface AccessTokenPayload {
  allowed_roles: string[];
  aud: string; // Audience (who the token is for)
  exp: number; // Expiration time (in seconds since epoch)
  iat: number; // Issued at time (in seconds since epoch)
  iss: string; // Issuer (auth server URL)
  login_method: string; // How user logged in (e.g., "basic_auth", "google", etc.)
  nonce: string; // Random value to link request/response
  roles: string[]; // Roles assigned to user
  scope: string[]; // Scopes like 'openid', 'email', 'profile'
  sub: string; // Subject (unique user ID)
  token_type: string; // Usually "access_token"
}

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

  async validate(payload: AccessTokenPayload): Promise<User> {
    const userId = payload.sub;
    // Pass true for top_level parameter to include decrypted API keys
    const user = await this.userService.getById(userId, true);
    // Include all Authorizer profile fields in the user object
    return new User({
      ...user,
      ...payload
    });
  }
}

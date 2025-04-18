import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

import { Strategy } from 'passport-local';

import { AuthenticationService } from '../authentication.service';

@Injectable()
export class LocalStrategy extends PassportStrategy(Strategy) {
  constructor(private authenticationService: AuthenticationService) {
    super({
      usernameField: 'email',
      passwordField: 'password',
      passReqToCallback: true
    });
  }

  async validate(request: any, email: string, password: string) {
    const rememberMe = request.body.remember === true;
    return this.authenticationService.getAuthenticatedUser(email, password, rememberMe);
  }
}

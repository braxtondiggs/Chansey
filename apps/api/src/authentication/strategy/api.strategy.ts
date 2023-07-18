import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { HeaderAPIKeyStrategy } from 'passport-headerapikey';

import { AuthenticationService } from '../authentication.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(HeaderAPIKeyStrategy, 'api-key') {
  constructor(private readonly authentication: AuthenticationService) {
    super(
      {
        header: 'Authorization',
        prefix: 'Api-Key'
      },
      true,
      async (apiKey: string, done: (error: Error | null, valid?: boolean) => void) => {
        if (this.authentication.validateAPIKey(apiKey)) return done(null, true);
        return done(new UnauthorizedException(), false);
      }
    );
  }
}

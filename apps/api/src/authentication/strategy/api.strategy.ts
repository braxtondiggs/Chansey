import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';

import { HeaderAPIKeyStrategy } from 'passport-headerapikey';

import { AuthenticationService } from '../authentication.service';

@Injectable()
export class ApiKeyStrategy extends PassportStrategy(HeaderAPIKeyStrategy, 'api-key') {
  constructor(private readonly authentication: AuthenticationService) {
    super(
      {
        header: 'Api-Key',
        prefix: ''
      },
      false
    );
  }

  async validate(apiKey: string): Promise<{ apiKey: boolean }> {
    if (this.authentication.validateAPIKey(apiKey)) {
      return { apiKey: true };
    }
    throw new UnauthorizedException('Invalid API Key');
  }
}

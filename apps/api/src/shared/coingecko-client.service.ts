import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { Coingecko } from '@coingecko/coingecko-typescript';

@Injectable()
export class CoinGeckoClientService {
  readonly client: Coingecko;

  constructor(private readonly configService: ConfigService) {
    const proKey = this.configService.get<string>('COINGECKO_API_KEY');
    const demoKey = this.configService.get<string>('COINGECKO_DEMO_API_KEY');

    if (proKey) {
      this.client = new Coingecko({ proAPIKey: proKey, environment: 'pro', timeout: 10_000, maxRetries: 0 });
    } else if (demoKey) {
      this.client = new Coingecko({ demoAPIKey: demoKey, environment: 'demo', timeout: 10_000, maxRetries: 0 });
    } else {
      this.client = new Coingecko({ environment: 'demo', timeout: 10_000, maxRetries: 0 });
    }
  }
}

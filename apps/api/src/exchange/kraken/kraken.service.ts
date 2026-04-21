import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { KRAKEN_BASE_ALIASES, KRAKEN_QUOTE_ALIASES } from '../constants';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class KrakenService extends BaseExchangeService {
  protected readonly exchangeSlug = 'kraken';
  protected readonly exchangeId: keyof typeof ccxt = 'kraken';
  protected readonly apiKeyConfigName = 'KRAKEN_API_KEY';
  protected readonly apiSecretConfigName = 'KRAKEN_API_SECRET';
  readonly quoteAsset = 'USD';

  protected override get freeBalanceAssets(): string[] {
    return ['USD', 'USDT'];
  }

  constructor(
    configService?: ConfigService,
    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService,
    @Optional() circuitBreaker?: CircuitBreakerService
  ) {
    super(configService, exchangeKeyService, exchangeService, circuitBreaker);
  }

  /**
   * Get a CCXT Kraken client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT Kraken client
   */
  async getKrakenClient(user?: User): Promise<ccxt.kraken> {
    return (await this.getClient(user)) as ccxt.kraken;
  }

  protected override normalizeAssetName(asset: string): string {
    return KRAKEN_QUOTE_ALIASES[asset] ?? KRAKEN_BASE_ALIASES[asset] ?? asset;
  }
}

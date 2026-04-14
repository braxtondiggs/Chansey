import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { CircuitBreakerService } from '../../shared/circuit-breaker.service';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class BinanceUSService extends BaseExchangeService {
  protected readonly exchangeSlug = 'binance_us';
  protected readonly exchangeId: keyof typeof ccxt = 'binanceus';
  protected readonly apiKeyConfigName = 'BINANCE_API_KEY';
  protected readonly apiSecretConfigName = 'BINANCE_API_SECRET';
  readonly quoteAsset = 'USDT';

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
   * Get a CCXT Binance.US client for a user or the default client
   * @param user Optional user for fetching their specific API keys
   * @returns A configured CCXT Binance.US client
   */
  async getBinanceClient(user?: User): Promise<ccxt.binanceus> {
    return (await this.getClient(user)) as ccxt.binanceus;
  }

  protected override getFetchBalanceParams(): object | undefined {
    return { type: 'spot' };
  }

  /**
   * Widen recvWindow to 15s and enable CCXT clock sync to prevent -1021 timestamp errors.
   */
  protected override getAdditionalClientConfig(): object {
    return {
      options: {
        recvWindow: 15_000,
        adjustForTimeDifference: true
      }
    };
  }
}

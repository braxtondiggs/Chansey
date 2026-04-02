import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class CoinbaseExchangeService extends BaseExchangeService {
  protected readonly exchangeSlug = 'gdax'; // Coinbase Pro's slug
  protected readonly exchangeId: keyof typeof ccxt = 'coinbaseexchange';
  protected readonly apiKeyConfigName = 'COINBASE_EXCHANGE_API_KEY';
  protected readonly apiSecretConfigName = 'COINBASE_EXCHANGE_API_SECRET';
  readonly quoteAsset = 'USD';

  protected override get balanceFilterByTotal(): boolean {
    return true;
  }

  protected override get balanceSilentOnError(): boolean {
    return true;
  }

  constructor(
    configService?: ConfigService,
    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService
  ) {
    super(configService, exchangeKeyService, exchangeService);
  }

  /**
   * Override formatSymbol for Coinbase Exchange (Pro) — accepts "BTC-USD" format
   */
  override formatSymbol(symbol: string): string {
    if (symbol.includes('/')) return symbol;
    // Convert "BTC-USD" → "BTC/USD"
    return symbol.replace('-', '/');
  }

  /**
   * Override getAdditionalClientConfig for Coinbase Pro specific configuration
   */
  protected getAdditionalClientConfig(): object {
    return {
      v3: true // Use v3 API for Coinbase Pro
    };
  }
}

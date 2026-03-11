import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import * as https from 'https';

import { isAuthenticationError, isTransientError, withRateLimitRetry } from '../../shared/retry.util';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { ExchangeKeyService } from '../exchange-key/exchange-key.service';
import { ExchangeService } from '../exchange.service';

@Injectable()
export class KrakenService extends BaseExchangeService {
  protected readonly exchangeSlug = 'kraken';
  protected readonly exchangeId: keyof typeof ccxt = 'kraken';
  protected readonly apiKeyConfigName = 'KRAKEN_API_KEY';
  protected readonly apiSecretConfigName = 'KRAKEN_API_SECRET';
  readonly quoteAsset = 'USD';

  constructor(
    configService?: ConfigService,
    @Inject(forwardRef(() => ExchangeService)) exchangeService?: ExchangeService,
    @Inject(forwardRef(() => ExchangeKeyService)) exchangeKeyService?: ExchangeKeyService
  ) {
    super(configService, exchangeKeyService, exchangeService);
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
    return asset === 'ZUSD' ? 'USD' : asset;
  }

  /**
   * Static method to validate Kraken API keys without requiring an instance
   * @param apiKey - The API key to validate
   * @param secretKey - The secret key to validate
   * @returns true if validation is successful, false otherwise
   */
  static async validateApiKeys(apiKey: string, secretKey: string): Promise<boolean> {
    // Create HTTP/HTTPS agents that force IPv4 only
    const httpsAgent = new https.Agent({
      family: 4 // Force IPv4
    });

    // Create a temporary Kraken client with the provided keys
    const client = new ccxt.kraken({
      apiKey,
      secret: secretKey.replace(/\\n/g, '\n').trim(),
      enableRateLimit: true,
      httpsAgent
    });

    try {
      const result = await withRateLimitRetry(() => client.fetchBalance(), {
        operationName: 'validateApiKeys',
        isRetryable: (err) => isTransientError(err) && !isAuthenticationError(err)
      });
      return result.success;
    } catch {
      return false;
    } finally {
      try {
        await client.close();
      } catch {
        /* empty */
      }
    }
  }
}

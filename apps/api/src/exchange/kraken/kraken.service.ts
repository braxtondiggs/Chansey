import { forwardRef, Inject, Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import * as ccxt from 'ccxt';

import * as https from 'https';

import { AssetBalanceDto } from '../../balance/dto/balance-response.dto';
import { toErrorInfo } from '../../shared/error.util';
import { User } from '../../users/users.entity';
import { BaseExchangeService } from '../base-exchange.service';
import { CCXT_BALANCE_META_KEYS } from '../ccxt-balance.util';
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

  /**
   * Override getBalance to handle Kraken-specific balance fetching
   * @param user The user to fetch balances for
   * @returns Array of balances
   */
  async getBalance(user: User): Promise<AssetBalanceDto[]> {
    try {
      const client = await this.getClient(user);
      const balanceData = await client.fetchBalance();

      const assetBalances: AssetBalanceDto[] = [];

      for (const [asset, balance] of Object.entries(balanceData)) {
        if (CCXT_BALANCE_META_KEYS.has(asset)) continue;

        const total = Number(balance.total ?? 0);
        const free = Number(balance.free ?? 0);
        const locked = total - free;

        if (free > 0 || locked > 0) {
          assetBalances.push({ asset, free: free.toString(), locked: locked.toString() });
        }
      }

      return assetBalances;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching ${this.constructor.name} balances`, err.stack || err.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} balances`);
    }
  }

  /**
   * Override getFreeBalance to handle Kraken-specific free balance fetching
   * @param user The user to get balances for
   * @returns USD balance information
   */
  async getFreeBalance(user: User) {
    try {
      const client = await this.getClient(user);
      const balanceData = await client.fetchBalance();

      const balances: AssetBalanceDto[] = [];

      for (const [asset, balance] of Object.entries(balanceData)) {
        if (CCXT_BALANCE_META_KEYS.has(asset)) continue;
        // Kraken uses ZUSD for USD
        if (asset !== 'USD' && asset !== 'ZUSD' && asset !== 'USDT') continue;

        const free = Number(balance.free ?? 0);
        if (free > 0) {
          const total = Number(balance.total ?? 0);
          balances.push({
            asset: asset === 'ZUSD' ? 'USD' : asset,
            free: free.toString(),
            locked: (total - free).toString()
          });
        }
      }

      return balances;
    } catch (error: unknown) {
      const err = toErrorInfo(error);
      this.logger.error(`Error fetching ${this.constructor.name} free balance`, err.stack || err.message);
      throw new InternalServerErrorException(`Failed to fetch ${this.constructor.name} free balance`);
    }
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
      // Try to fetch balance - this will throw an error if the keys are invalid
      await client.fetchBalance();
      return true;
    } catch (error: unknown) {
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
